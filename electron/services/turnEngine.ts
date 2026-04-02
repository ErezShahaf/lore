import { logger } from '../logger'
import { collectChatResponse, streamChatWithTools, splitForTypingEffect } from './ollamaService'
import { streamAssistantUserReplyWithFallback } from './assistantReplyComposer'
import {
  resetUiStatusPhraseCacheForNewTurn,
  resolveUiStatusMessage,
  UiStatusPhase,
} from './uiStatusPhraseComposer'
import { getOllamaToolsForWorker, type OrchestratorToolContext } from './orchestratorTools'
import { executeOrchestratorToolWithHooks } from './toolHooks'
import {
  buildWorkerSystemPrompt,
  loadProgressiveComposeSkillAddon,
  resolveWorkerForTurn,
} from './workerRouter'
import { getSettings } from './settingsService'
import type {
  AgentEvent,
  ConversationEntry,
  MutablePipelineTraceSink,
  ToolChatMessage,
} from '../../shared/types'
import { ORCHESTRATOR_MAX_STEPS } from '../../shared/types'

function conversationToToolMessages(
  history: readonly ConversationEntry[],
): ToolChatMessage[] {
  return history.map((entry) => ({
    role: entry.role === 'assistant' ? 'assistant' : 'user',
    content: entry.content,
  }))
}

function toolAgentToStatusPhase(agentName: string): string {
  switch (agentName) {
    case 'search_library':
      return UiStatusPhase.toolSearchLibrary
    case 'search_for_question':
      return UiStatusPhase.toolSearchForQuestion
    case 'search_for_command':
      return UiStatusPhase.toolSearchForCommand
    case 'get_document':
      return UiStatusPhase.toolGetDocument
    case 'save_documents':
      return UiStatusPhase.toolSaveDocuments
    case 'modify_documents':
      return UiStatusPhase.toolModifyDocuments
    case 'compose_reply':
      return UiStatusPhase.toolComposeReply
    default:
      return UiStatusPhase.toolRunningUnknown
  }
}

function workerKindToStatusPhase(workerKind: string): string {
  switch (workerKind) {
    case 'question':
      return UiStatusPhase.workerFocusQuestion
    case 'thought':
      return UiStatusPhase.workerFocusThought
    case 'command':
      return UiStatusPhase.workerFocusCommand
    case 'conversational':
      return UiStatusPhase.workerFocusConversational
    default:
      return UiStatusPhase.workerFocusConversational
  }
}

export interface NativeToolLoopOptions {
  readonly traceSink: MutablePipelineTraceSink | null
  readonly userInstructionsBlock: string
  readonly isCancelled: () => boolean
  readonly priorTurnRetrievedContextBlock: string | null
}

/**
 * Ollama native `tool_calls` loop with shared orchestrator tool execution and pipeline traces.
 */
export async function* runNativeToolLoopTurn(
  userInput: string,
  priorHistory: readonly ConversationEntry[],
  options: NativeToolLoopOptions,
): AsyncGenerator<AgentEvent> {
  const { traceSink, userInstructionsBlock, isCancelled, priorTurnRetrievedContextBlock } = options

  resetUiStatusPhraseCacheForNewTurn()

  yield {
    type: 'status',
    message: await resolveUiStatusMessage({
      request: { phase: UiStatusPhase.workingOnMessage },
      userInstructionsBlock,
    }),
  }

  yield {
    type: 'status',
    message: await resolveUiStatusMessage({
      request: { phase: UiStatusPhase.figuringOutNeed },
      userInstructionsBlock,
    }),
  }

  if (isCancelled()) {
    if (traceSink) {
      traceSink.stages.push({
        stageId: 'turn_engine_native_round',
        ordinal: traceSink.stages.length,
        timestamp: new Date().toISOString(),
        output: {
          loopStep: -1,
          hadToolCalls: false,
          toolNames: [],
          stopReason: 'cancelled',
          assistantPreview: '',
        },
      })
    }
    yield { type: 'done' }
    return
  }

  let workerKind: Awaited<ReturnType<typeof resolveWorkerForTurn>>['workerKind']
  let classification: Awaited<ReturnType<typeof resolveWorkerForTurn>>['classification']
  try {
    const resolved = await resolveWorkerForTurn(userInput, priorHistory, userInstructionsBlock)
    workerKind = resolved.workerKind
    classification = resolved.classification
    logger.debug({ workerKind }, '[TurnEngine] Router resolved worker')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Routing failed'
    logger.error({ message }, '[TurnEngine] Worker resolution failed')
    yield { type: 'error', message }
    yield { type: 'done' }
    return
  }

  if (traceSink) {
    traceSink.stages.push({
      stageId: 'turn_engine_router',
      ordinal: traceSink.stages.length,
      timestamp: new Date().toISOString(),
      output: { workerKind },
    })
  }

  yield {
    type: 'status',
    message: await resolveUiStatusMessage({
      request: { phase: workerKindToStatusPhase(workerKind) },
      userInstructionsBlock,
    }),
  }

  let systemPrompt = buildWorkerSystemPrompt(workerKind, userInstructionsBlock, classification)
  const progressiveAddon = loadProgressiveComposeSkillAddon(workerKind)
  if (progressiveAddon.trim().length > 0) {
    systemPrompt = `${systemPrompt}\n\n## Reply composition reference\n\n${progressiveAddon}`
  }

  const settings = getSettings()
  const model = settings.selectedModel
  const tools = getOllamaToolsForWorker(workerKind)

  const context: OrchestratorToolContext = {
    userInput,
    priorHistory,
    userInstructionsBlock,
    documentsCache: new Map(),
  }

  const baseMessages: ToolChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...conversationToToolMessages(priorHistory),
  ]

  if (priorTurnRetrievedContextBlock !== null && priorTurnRetrievedContextBlock.trim().length > 0) {
    baseMessages.push({ role: 'user', content: priorTurnRetrievedContextBlock.trim() })
  }

  baseMessages.push({ role: 'user', content: userInput })

  if (tools.length === 0) {
    const plainMessages = baseMessages.map((message) => ({
      role: message.role as 'system' | 'user' | 'assistant',
      content: message.content,
    }))
    try {
      const text = await collectChatResponse({
        model,
        messages: plainMessages,
        stream: false,
        think: false,
      })
      const trimmed = text.trim()
      if (trimmed.length > 0) {
        for (const piece of splitForTypingEffect(trimmed)) {
          yield { type: 'chunk', content: piece }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Chat request failed'
      logger.error({ message }, '[TurnEngine] Conversational path failed')
      yield { type: 'error', message }
    }
    yield { type: 'done' }
    return
  }

  let messages: ToolChatMessage[] = [...baseMessages]

  for (let step = 0; step < ORCHESTRATOR_MAX_STEPS; step += 1) {
    if (isCancelled()) {
      if (traceSink) {
        traceSink.stages.push({
          stageId: 'turn_engine_native_round',
          ordinal: traceSink.stages.length,
          timestamp: new Date().toISOString(),
          output: {
            loopStep: step,
            hadToolCalls: false,
            toolNames: [],
            stopReason: 'cancelled',
            assistantPreview: '',
          },
        })
      }
      yield { type: 'done' }
      return
    }

    yield {
      type: 'status',
      message: await resolveUiStatusMessage({
        request: {
          phase: step === 0 ? UiStatusPhase.orchestratorDecidingNext : UiStatusPhase.orchestratorAnotherPass,
          orchestratorLoopStep: step,
        },
        userInstructionsBlock,
      }),
    }

    let assistantMessage: ToolChatMessage
    try {
      const toolStream = streamChatWithTools({
        model,
        messages,
        tools,
      })

      let finalAssistant: ToolChatMessage | null = null
      for await (const event of toolStream) {
        if (event.type === 'content_chunk') {
          yield { type: 'chunk', content: event.text }
        } else if (event.type === 'assistant_message') {
          finalAssistant = event.message
        }
      }
      if (finalAssistant === null) {
        throw new Error('TurnEngine: missing final assistant message from stream')
      }
      assistantMessage = finalAssistant
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ollama tool chat failed'
      logger.error({ message, step }, '[TurnEngine] streamChatWithTools failed')
      yield { type: 'error', message }
      yield { type: 'done' }
      return
    }

    const toolCalls = assistantMessage.tool_calls ?? []
    const preview = assistantMessage.content.trim().slice(0, 400)

    if (traceSink) {
      traceSink.stages.push({
        stageId: 'turn_engine_native_round',
        ordinal: traceSink.stages.length,
        timestamp: new Date().toISOString(),
        output: {
          loopStep: step,
          hadToolCalls: toolCalls.length > 0,
          toolNames: toolCalls.map((call) => call.function.name),
          stopReason: toolCalls.length > 0 ? 'tool_round' : 'model_reply',
          assistantPreview: preview,
        },
      })
    }

    if (toolCalls.length === 0) {
      yield { type: 'done' }
      return
    }

    messages = [...messages, assistantMessage]

    for (const toolCall of toolCalls) {
      if (isCancelled()) {
        yield { type: 'done' }
        return
      }

      const toolName = toolCall.function.name
      yield {
        type: 'status',
        message: await resolveUiStatusMessage({
          request: { phase: toolAgentToStatusPhase(toolName), toolAgent: toolName },
          userInstructionsBlock,
        }),
      }

      const result = await executeOrchestratorToolWithHooks(
        toolName,
        toolCall.function.arguments,
        context,
      )

      for (const agentEvent of result.events) {
        if (agentEvent.type !== 'chunk' && agentEvent.type !== 'turn_step_summary') {
          yield agentEvent
        }
      }

      messages.push({
        role: 'tool',
        content: result.output,
        name: toolName,
      })
    }
  }

  logger.warn('[TurnEngine] Exhausted max tool rounds')
  if (traceSink) {
    traceSink.stages.push({
      stageId: 'turn_engine_native_round',
      ordinal: traceSink.stages.length,
      timestamp: new Date().toISOString(),
      output: {
        loopStep: ORCHESTRATOR_MAX_STEPS,
        hadToolCalls: true,
        toolNames: [],
        stopReason: 'max_rounds',
        assistantPreview: '',
      },
    })
  }

  for await (const chunk of streamAssistantUserReplyWithFallback({
    userInstructionsBlock,
    facts: { kind: 'orchestrator_surface_fallback', trigger: 'max_steps_exhausted' },
  })) {
    yield { type: 'chunk', content: chunk }
  }
  yield { type: 'done' }
}
