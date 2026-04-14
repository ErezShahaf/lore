import { app } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { logger } from '../logger'
import { getSettings } from './settingsService'
import { chatWithTools, splitForTypingEffect, streamPlainResponse } from './ollamaService'
import { getToolDefinitions, executeTool } from './toolRegistry'
import { formatLocalDate, dayOfWeekName, subtractDays, startOfWeek } from './localDate'
import {
  formatUserInstructionsBlock,
  loadAllUserInstructionDocuments,
} from './userInstructionsContext'
import type {
  AgentEvent,
  ConversationEntry,
  MutablePipelineTraceSink,
  ToolChatMessage,
} from '../../shared/types'

const MAX_TOOL_LOOP_ITERATIONS = 6
const TOOL_RESULT_CONTENT_MAX_CHARS = 2000
const WORKING_MEMORY_SEARCH_PREVIEW_MAX_CHARS = 150

interface WorkingMemoryEntry {
  readonly tool: string
  readonly summary: string
}

interface WorkingMemoryState {
  readonly actions: WorkingMemoryEntry[]
  readonly storedDocumentIds: string[]
  readonly deletedDocumentIds: string[]
  readonly retrievedDocumentIds: string[]
}

function createEmptyWorkingMemory(): WorkingMemoryState {
  return {
    actions: [],
    storedDocumentIds: [],
    deletedDocumentIds: [],
    retrievedDocumentIds: [],
  }
}

function formatWorkingMemory(memory: WorkingMemoryState): string {
  if (memory.actions.length === 0) {
    return ''
  }

  const lines = ['<working_memory>', 'Actions taken so far this turn:']
  for (const entry of memory.actions) {
    lines.push(`- [${entry.tool}] ${entry.summary}`)
  }
  if (memory.storedDocumentIds.length > 0) {
    lines.push(`Documents saved: ${memory.storedDocumentIds.length}`)
  }
  if (memory.deletedDocumentIds.length > 0) {
    lines.push(`Documents deleted: ${memory.deletedDocumentIds.length}`)
  }
  if (memory.retrievedDocumentIds.length > 0) {
    lines.push(`Documents retrieved: ${memory.retrievedDocumentIds.length}`)
  }
  lines.push('</working_memory>')
  return lines.join('\n')
}

function summarizeToolResult(toolName: string, rawOutput: string): string {
  try {
    const parsed = JSON.parse(rawOutput) as Record<string, unknown>

    if (toolName === 'search_library') {
      const documents = parsed.documents as ReadonlyArray<Record<string, unknown>> | undefined
      const totalFound = parsed.totalFound as number | undefined
      if (!documents || documents.length === 0) {
        return `Search returned 0 results (total scanned: ${totalFound ?? 0}).`
      }
      const previews = documents.map((document) => {
        const id = document.id as string
        const type = document.type as string
        const contentPreview = (document.contentPreview as string ?? '').slice(
          0,
          WORKING_MEMORY_SEARCH_PREVIEW_MAX_CHARS,
        )
        const score = document.score as number
        return `  {id: "${id}", type: "${type}", score: ${score}, preview: "${contentPreview}"}`
      })
      return `Found ${documents.length} document(s) (total: ${totalFound ?? documents.length}):\n${previews.join('\n')}`
    }

    if (toolName === 'get_document') {
      if (parsed.error) {
        return `Document not found: ${parsed.error}`
      }
      const id = parsed.id as string
      const type = parsed.type as string
      const content = parsed.content as string ?? ''
      const truncated = content.length > TOOL_RESULT_CONTENT_MAX_CHARS
        ? `${content.slice(0, TOOL_RESULT_CONTENT_MAX_CHARS)}…`
        : content
      return `Document ${id} (${type}):\n${truncated}`
    }

    if (toolName === 'save_documents') {
      const results = parsed.results as ReadonlyArray<Record<string, unknown>> | undefined
      if (!results) return 'Save completed (no details).'
      const summaries = results.map((result) => {
        const status = result.status as string
        const id = result.id as string
        if (status === 'duplicate_found') {
          return `  Duplicate found (existing id: ${id}, preview: "${(result.duplicatePreview as string ?? '').slice(0, 80)}")`
        }
        return `  Saved: id="${id}"`
      })
      return `Save results:\n${summaries.join('\n')}`
    }

    if (toolName === 'modify_documents') {
      const results = parsed.results as ReadonlyArray<Record<string, unknown>> | undefined
      if (!results) return 'Modify completed (no details).'
      const summaries = results.map((result) => {
        const documentId = result.documentId as string
        const action = result.action as string
        const status = result.status as string
        return `  ${action} ${documentId}: ${status}`
      })
      return `Modify results:\n${summaries.join('\n')}`
    }

    return rawOutput.slice(0, TOOL_RESULT_CONTENT_MAX_CHARS)
  } catch {
    return rawOutput.slice(0, TOOL_RESULT_CONTENT_MAX_CHARS)
  }
}

function updateWorkingMemoryFromToolResult(
  memory: WorkingMemoryState,
  toolName: string,
  rawOutput: string,
): WorkingMemoryState {
  const summary = summarizeToolResult(toolName, rawOutput)
  const newActions = [...memory.actions, { tool: toolName, summary }]
  const storedDocumentIds = [...memory.storedDocumentIds]
  const deletedDocumentIds = [...memory.deletedDocumentIds]
  const retrievedDocumentIds = [...memory.retrievedDocumentIds]

  try {
    const parsed = JSON.parse(rawOutput) as Record<string, unknown>

    if (toolName === 'search_library') {
      const documents = parsed.documents as ReadonlyArray<Record<string, unknown>> | undefined
      if (documents) {
        for (const document of documents) {
          const id = document.id as string
          if (id && !retrievedDocumentIds.includes(id)) {
            retrievedDocumentIds.push(id)
          }
        }
      }
    }

    if (toolName === 'save_documents') {
      const results = parsed.results as ReadonlyArray<Record<string, unknown>> | undefined
      if (results) {
        for (const result of results) {
          if (result.status === 'saved' && typeof result.id === 'string' && result.id.length > 0) {
            storedDocumentIds.push(result.id as string)
          }
        }
      }
    }

    if (toolName === 'modify_documents') {
      const results = parsed.results as ReadonlyArray<Record<string, unknown>> | undefined
      if (results) {
        for (const result of results) {
          if (result.status === 'success' && result.action === 'delete') {
            deletedDocumentIds.push(result.documentId as string)
          }
        }
      }
    }
  } catch {
    // non-JSON output, skip structured extraction
  }

  return {
    actions: newActions,
    storedDocumentIds,
    deletedDocumentIds,
    retrievedDocumentIds,
  }
}

let cachedAgentPromptTemplate: string | null = null

function getSkillsDirectory(): string {
  if (!app.isPackaged) {
    return join(process.cwd(), 'skills')
  }
  return join(process.resourcesPath, 'skills')
}

function loadAgentPromptTemplate(): string {
  if (cachedAgentPromptTemplate !== null) {
    return cachedAgentPromptTemplate
  }
  const promptPath = join(getSkillsDirectory(), 'agent-prompt.md')
  cachedAgentPromptTemplate = readFileSync(promptPath, 'utf-8')
  return cachedAgentPromptTemplate
}

export function clearAgentPromptCache(): void {
  cachedAgentPromptTemplate = null
}

function buildSystemPrompt(userInstructionsBlock: string): string {
  const now = new Date()
  const today = formatLocalDate(now)
  const dayName = dayOfWeekName(now)
  const yesterday = formatLocalDate(subtractDays(now, 1))
  const weekStart = formatLocalDate(startOfWeek(now))
  const lastWeekStart = formatLocalDate(subtractDays(startOfWeek(now), 7))

  let prompt = loadAgentPromptTemplate()
  prompt = prompt.replace(/\{currentDate\}/g, today)
  prompt = prompt.replace(/\{currentDay\}/g, dayName)
  prompt = prompt.replace(/\{yesterdayDate\}/g, yesterday)
  prompt = prompt.replace(/\{thisWeekStart\}/g, weekStart)
  prompt = prompt.replace(/\{lastWeekStart\}/g, lastWeekStart)

  const instructionsTrimmed = userInstructionsBlock.trim()
  if (instructionsTrimmed.length > 0) {
    prompt = prompt.replace(/\{userInstructionsBlock\}/g, instructionsTrimmed)
  } else {
    prompt = prompt.replace(/\{userInstructionsBlock\}/g, '(none)')
  }

  return prompt
}

function* relayAssistantThinkingToThinkingStream(
  assistantThinkingText: string,
): Generator<AgentEvent, void, unknown> {
  const trimmed = assistantThinkingText.trim()
  if (trimmed.length === 0) {
    return
  }
  const pieces = splitForTypingEffect(trimmed)
  for (const piece of pieces) {
    yield { type: 'thinking_chunk', content: piece }
  }
}

function buildConversationMessages(
  systemPrompt: string,
  conversationHistory: readonly ConversationEntry[],
  userInput: string,
  workingMemory: WorkingMemoryState,
): ToolChatMessage[] {
  const messages: ToolChatMessage[] = [
    { role: 'system', content: systemPrompt },
  ]

  for (const entry of conversationHistory) {
    messages.push({ role: entry.role, content: entry.content })
  }

  const workingMemoryBlock = formatWorkingMemory(workingMemory)
  const userContent = workingMemoryBlock.length > 0
    ? `${workingMemoryBlock}\n\n${userInput}`
    : userInput

  messages.push({ role: 'user', content: userContent })

  return messages
}

export async function* runLoopAgentTurn(
  userInput: string,
  priorHistory: readonly ConversationEntry[],
  traceSink: MutablePipelineTraceSink | null = null,
): AsyncGenerator<AgentEvent> {
  const userInstructionDocuments = await loadAllUserInstructionDocuments()
  const userInstructionsBlock = formatUserInstructionsBlock(userInstructionDocuments)
  const settings = getSettings()
  const toolDefinitions = getToolDefinitions()

  yield { type: 'status', message: 'Thinking…' }

  const systemPrompt = buildSystemPrompt(userInstructionsBlock)
  let workingMemory = createEmptyWorkingMemory()

  let conversationMessages = buildConversationMessages(
    systemPrompt,
    priorHistory,
    userInput,
    workingMemory,
  )

  for (let iteration = 0; iteration < MAX_TOOL_LOOP_ITERATIONS; iteration += 1) {
    logger.debug(
      { iteration, messageCount: conversationMessages.length },
      '[LoopAgent] Calling model',
    )

    let response
    try {
      response = await chatWithTools({
        model: settings.selectedModel,
        messages: conversationMessages,
        tools: toolDefinitions,
        options: { num_ctx: 16384 },
      })
    } catch (error) {
      logger.error({ err: error, iteration }, '[LoopAgent] Model call failed')
      yield {
        type: 'error',
        message: error instanceof Error ? error.message : 'Model call failed',
      }
      yield { type: 'done' }
      return
    }

    const assistantMessage = response.message
    const hasToolCalls =
      assistantMessage.tool_calls !== undefined && assistantMessage.tool_calls.length > 0

    if (hasToolCalls) {
      yield* relayAssistantThinkingToThinkingStream(response.assistantThinkingText)
    }

    if (!hasToolCalls) {
      if (traceSink) {
        traceSink.stages.push({
          stageId: 'unified_classifier',
          ordinal: traceSink.stages.length,
          timestamp: new Date().toISOString(),
          output: {
            actions: [{
              intent: 'speak',
              extractedDate: null,
              extractedTags: [],
              situationSummary: `Loop agent responded after ${iteration} tool call(s).`,
              data: '',
              saveDocumentType: null,
            }],
          },
        })
      }

      const alreadyGeneratedText = assistantMessage.content.trim()
      if (alreadyGeneratedText.length > 0) {
        yield* relayAssistantThinkingToThinkingStream(response.assistantThinkingText)
        yield* emitTextAsChunks(alreadyGeneratedText)
        yield { type: 'done' }
      } else {
        yield* streamFinalResponse(settings.selectedModel, conversationMessages, workingMemory)
      }
      return
    }

    conversationMessages = [
      ...conversationMessages,
      assistantMessage,
    ]

    for (const toolCall of assistantMessage.tool_calls!) {
      const toolName = toolCall.function.name
      const toolArguments = toolCall.function.arguments

      logger.debug(
        { toolName, iteration, argKeys: Object.keys(toolArguments) },
        '[LoopAgent] Executing tool',
      )

      const statusMessage =
        toolName === 'search_library' ? 'Searching notes…'
        : toolName === 'save_documents' ? 'Saving…'
        : toolName === 'modify_documents' ? 'Updating…'
        : toolName === 'get_document' ? 'Reading document…'
        : 'Working…'
      yield { type: 'status', message: statusMessage }

      const toolResult = await executeTool(toolName, toolArguments)

      for (const event of toolResult.events) {
        yield event
      }

      workingMemory = updateWorkingMemoryFromToolResult(
        workingMemory,
        toolName,
        toolResult.output,
      )

      const truncatedOutput = toolResult.output.length > TOOL_RESULT_CONTENT_MAX_CHARS
        ? `${toolResult.output.slice(0, TOOL_RESULT_CONTENT_MAX_CHARS)}…(truncated)`
        : toolResult.output

      conversationMessages = [
        ...conversationMessages,
        { role: 'tool', content: truncatedOutput, name: toolName },
      ]
    }

    if (traceSink) {
      traceSink.stages.push({
        stageId: 'action_execution',
        ordinal: traceSink.stages.length,
        timestamp: new Date().toISOString(),
        output: {
          actionIndex: iteration,
          intent: inferIntentFromWorkingMemory(workingMemory),
          status: 'succeeded',
          handlerResultSummary: workingMemory.actions[workingMemory.actions.length - 1]?.summary ?? '',
          storedDocumentIds: workingMemory.storedDocumentIds,
          retrievedDocumentIds: workingMemory.retrievedDocumentIds,
          deletedDocumentCount: workingMemory.deletedDocumentIds.length,
          messagePreview: '',
        },
      })
    }
  }

  logger.warn('[LoopAgent] Reached max iterations, forcing response')
  yield* streamFinalResponse(settings.selectedModel, conversationMessages, workingMemory)
}

function* emitTextAsChunks(text: string): Generator<AgentEvent, void, unknown> {
  const pieces = splitForTypingEffect(text)
  for (const piece of pieces) {
    yield { type: 'chunk', content: piece }
  }
}

async function* streamFinalResponse(
  model: string,
  conversationMessages: readonly ToolChatMessage[],
  workingMemory: WorkingMemoryState,
): AsyncGenerator<AgentEvent> {
  try {
    let receivedContent = false
    const stream = streamPlainResponse({
      model,
      messages: conversationMessages,
      options: { num_ctx: 16384 },
    })

    for await (const event of stream) {
      if (event.type === 'thinking_token') {
        yield { type: 'thinking_chunk', content: event.text }
      }
      if (event.type === 'content_token') {
        yield { type: 'chunk', content: event.text }
        receivedContent = true
      }
    }

    if (!receivedContent) {
      yield { type: 'chunk', content: buildFallbackResponse(workingMemory) }
    }
  } catch (error) {
    logger.error({ err: error }, '[LoopAgent] Streaming final response failed')
    yield { type: 'chunk', content: buildFallbackResponse(workingMemory) }
  }
  yield { type: 'done' }
}

function inferIntentFromWorkingMemory(
  memory: WorkingMemoryState,
): 'read' | 'save' | 'delete' | 'speak' {
  if (memory.deletedDocumentIds.length > 0) return 'delete'
  if (memory.storedDocumentIds.length > 0) return 'save'
  if (memory.retrievedDocumentIds.length > 0) return 'read'
  return 'speak'
}

function buildFallbackResponse(memory: WorkingMemoryState): string {
  const hadToolSideEffects =
    memory.storedDocumentIds.length > 0
    || memory.deletedDocumentIds.length > 0
    || memory.retrievedDocumentIds.length > 0

  if (hadToolSideEffects) {
    return (
      'The reply did not finish streaming. Your last action may still have gone through—ask me to list your todos or try again.'
    )
  }

  return "I'm here to help with your notes and todos. What would you like to do?"
}
