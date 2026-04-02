import { logger } from '../logger'
import { collectChatResponse, parseJsonFromModelResponse } from './ollamaService'
import { getSettings } from './settingsService'
import { streamAssistantUserReplyWithFallback } from './assistantReplyComposer'
import { formatUserInstructionsBlock, loadAllUserInstructionDocuments } from './userInstructionsContext'
import {
  resetUiStatusPhraseCacheForNewTurn,
  resolveUiStatusMessage,
  UiStatusPhase,
} from './uiStatusPhraseComposer'
import { type OrchestratorToolContext } from './orchestratorTools'
import { executeOrchestratorToolWithHooks } from './toolHooks'
import { buildWorkerSystemPrompt, getToolsForWorker, resolveWorkerForTurn, type WorkerKind } from './workerRouter'
import {
  ORCHESTRATOR_MAX_STEPS,
  type AgentEvent,
  type ConversationEntry,
  type OrchestratorAction,
} from '../../shared/types'

function conversationHistoryToMessages(
  history: readonly ConversationEntry[],
): Array<{ role: 'user' | 'assistant'; content: string }> {
  return history.map((entry) => ({
    role: entry.role,
    content: entry.content,
  }))
}

function parseOrchestratorAction(raw: string): OrchestratorAction | null {
  const parsed = parseJsonFromModelResponse(raw)
  if (!parsed || typeof parsed.action !== 'string') return null

  const action = parsed.action as string
  if (action === 'reply') {
    const content = typeof parsed.content === 'string' ? parsed.content : String(parsed.content ?? '')
    return { action: 'reply', content }
  }

  if (action === 'call') {
    const agent = typeof parsed.agent === 'string' ? parsed.agent : ''
    if (!agent) return null
    const params =
      parsed.params && typeof parsed.params === 'object' && !Array.isArray(parsed.params)
        ? (parsed.params as Record<string, unknown>)
        : {}
    return { action: 'call', agent, params }
  }

  return null
}

function formatToolResultForNextMessage(agent: string, output: string): string {
  return `[Result from ${agent}]: ${output}`
}

function formatValidAgentsHint(workerKind: WorkerKind, validAgentNames: ReadonlySet<string>): string {
  if (validAgentNames.size === 0) {
    return 'You cannot call tools in this mode. Respond with exactly {"action":"reply","content":"..."} only.'
  }
  return `Valid agents for this worker (${workerKind}): ${[...validAgentNames].sort().join(', ')}.`
}

function jsonRetryUserMessage(workerKind: WorkerKind, validAgentNames: ReadonlySet<string>): string {
  const base =
    'Your last response was not valid JSON. Respond with exactly one JSON object: either {"action":"call","agent":"<name>","params":{...}} or {"action":"reply","content":"..."}. Try again.'
  return `${base} ${formatValidAgentsHint(workerKind, validAgentNames)}`
}

export interface ToolOrchestratorTurnResult {
  assistantResponse: string
  lastDocumentIds: string[]
}

export async function* runToolOrchestratedTurn(
  userInput: string,
  priorHistory: readonly ConversationEntry[],
): AsyncGenerator<AgentEvent> {
  const userInstructionDocuments = await loadAllUserInstructionDocuments()
  const userInstructionsBlock = formatUserInstructionsBlock(userInstructionDocuments)

  resetUiStatusPhraseCacheForNewTurn()

  yield {
    type: 'status',
    message: await resolveUiStatusMessage({
      request: { phase: UiStatusPhase.workingOnMessage },
      userInstructionsBlock,
    }),
  }

  const settings = getSettings()
  const model = settings.selectedModel

  yield {
    type: 'status',
    message: await resolveUiStatusMessage({
      request: { phase: UiStatusPhase.figuringOutNeed },
      userInstructionsBlock,
    }),
  }

  let workerKind: WorkerKind
  let routerClassification: Awaited<ReturnType<typeof resolveWorkerForTurn>>['classification']

  try {
    const resolved = await resolveWorkerForTurn(userInput, priorHistory, userInstructionsBlock)
    workerKind = resolved.workerKind
    routerClassification = resolved.classification
    logger.debug(
      {
        event: 'router_decision',
        workerKind,
        classification: routerClassification,
      },
      '[ToolOrchestrator] Router decided worker',
    )
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Routing failed'
    logger.error({ error: errorMessage }, '[ToolOrchestrator] Worker resolution failed')
    yield { type: 'error', message: errorMessage }
    yield { type: 'done' }
    return
  }

  yield {
    type: 'status',
    message: await resolveUiStatusMessage({
      request: { phase: workerKindToStatusPhase(workerKind) },
      userInstructionsBlock,
    }),
  }

  const systemPrompt = buildWorkerSystemPrompt(workerKind, userInstructionsBlock, routerClassification)

  const context: OrchestratorToolContext = {
    userInput,
    priorHistory,
    userInstructionsBlock,
    documentsCache: new Map(),
  }

  const allowedToolNames = getToolsForWorker(workerKind)
  const validAgentNames = new Set(allowedToolNames)

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
    ...conversationHistoryToMessages(priorHistory),
    { role: 'user', content: userInput },
  ]

  const collectedDocumentIds: string[] = []
  let assistantResponse = ''

  for (let step = 0; step < ORCHESTRATOR_MAX_STEPS; step += 1) {
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

    let rawResponse: string
    try {
      rawResponse = await collectChatResponse({
        model,
        messages,
        stream: false,
        think: false,
      })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Ollama request failed'
      logger.error({ error: errorMessage, step }, '[ToolOrchestrator] Chat request failed')
      yield { type: 'error', message: errorMessage }
      yield { type: 'done' }
      return
    }

    const parsed = parseOrchestratorAction(rawResponse)

    if (!parsed) {
      logger.warn(
        { step, rawPreview: rawResponse.slice(0, 300), messageCount: messages.length },
        '[ToolOrchestrator] Failed to parse orchestrator action',
      )
      messages.push({
        role: 'user',
        content: jsonRetryUserMessage(workerKind, validAgentNames),
      })
      continue
    }

    if (parsed.action === 'reply') {
      logger.debug(
        {
          event: 'worker_decision',
          workerKind,
          step,
          decision: parsed,
        },
        '[ToolOrchestrator] Worker produced reply decision',
      )
      assistantResponse = parsed.content.trim()
      if (assistantResponse) {
        yield { type: 'chunk', content: assistantResponse }
      } else {
        for await (const chunk of streamAssistantUserReplyWithFallback({
          userInstructionsBlock,
          facts: { kind: 'orchestrator_surface_fallback', trigger: 'empty_decision_reply' },
        })) {
          yield { type: 'chunk', content: chunk }
        }
      }
      yield { type: 'done' }
      return
    }

    if (!validAgentNames.has(parsed.agent)) {
      logger.warn(
        { agent: parsed.agent, validAgents: [...validAgentNames], workerKind },
        '[ToolOrchestrator] Unknown or disallowed agent for worker',
      )
      messages.push({
        role: 'assistant',
        content: JSON.stringify({ action: 'call', agent: parsed.agent, params: parsed.params }),
      })
      messages.push({
        role: 'user',
        content: `Unknown or disallowed agent "${parsed.agent}". ${formatValidAgentsHint(workerKind, validAgentNames)}`,
      })
      continue
    }

    logger.debug(
      {
        event: 'worker_decision',
        workerKind,
        step,
        action: parsed.action,
        agentName: parsed.agent,
        decision: parsed,
      },
      '[ToolOrchestrator] Worker produced tool-call decision',
    )

    yield {
      type: 'status',
      message: await resolveUiStatusMessage({
        request: { phase: toolAgentToStatusPhase(parsed.agent), toolAgent: parsed.agent },
        userInstructionsBlock,
      }),
    }

    logger.debug(
      { agent: parsed.agent, params: JSON.stringify(parsed.params ?? {}).slice(0, 200), step },
      '[ToolOrchestrator] Executing agent',
    )

    const result = await executeOrchestratorToolWithHooks(
      parsed.agent,
      parsed.params ?? {},
      context,
    )

    for (const event of result.events) {
      if (event.type === 'retrieved') {
        collectedDocumentIds.push(...event.documentIds)
      }
      if (event.type === 'stored') {
        collectedDocumentIds.push(event.documentId)
      }
      if (event.type !== 'chunk' && event.type !== 'turn_step_summary') {
        yield event
      }
    }

    messages.push({
      role: 'assistant',
      content: JSON.stringify({ action: 'call', agent: parsed.agent, params: parsed.params ?? {} }),
    })
    messages.push({
      role: 'user',
      content: formatToolResultForNextMessage(parsed.agent, result.output),
    })
  }

  logger.warn('[ToolOrchestrator] Exhausted max steps without final response')
  for await (const chunk of streamAssistantUserReplyWithFallback({
    userInstructionsBlock,
    facts: { kind: 'orchestrator_surface_fallback', trigger: 'max_steps_exhausted' },
  })) {
    yield { type: 'chunk', content: chunk }
  }
  yield { type: 'done' }
}

function workerKindToStatusPhase(workerKind: WorkerKind): string {
  switch (workerKind) {
    case 'question':
      return UiStatusPhase.workerFocusQuestion
    case 'thought':
      return UiStatusPhase.workerFocusThought
    case 'command':
      return UiStatusPhase.workerFocusCommand
    case 'conversational':
      return UiStatusPhase.workerFocusConversational
  }
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
