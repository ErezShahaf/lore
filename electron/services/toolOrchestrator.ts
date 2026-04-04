import { logger } from '../logger'
import { chat, collectChatResponse } from './ollamaService'
import {
  conversationHistoryToOrchestratorMessages,
  formatToolResultForNextMessage,
  formatValidAgentsHint,
  jsonRetryUserMessage,
  parseOrchestratorAction,
  STREAM_RESULT_FOLLOW_UP_USER_MESSAGE,
} from './orchestratorJsonProtocol'
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
import {
  buildWorkerSystemPrompt,
  getToolsForWorker,
  resolveWorkerForTurn,
  type WorkerKind,
} from './workerRouter'
import { ORCHESTRATOR_MAX_STEPS, type AgentEvent, type ConversationEntry } from '../../shared/types'

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
    isUnifiedNativeAgent: false,
  }

  const allowedToolNames = getToolsForWorker(workerKind)
  const validAgentNames = new Set(allowedToolNames)

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
    ...conversationHistoryToOrchestratorMessages(priorHistory),
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

    const parsed = parseOrchestratorAction(rawResponse, validAgentNames)

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

    if (parsed.action === 'stream_result') {
      logger.debug({ step, workerKind }, '[ToolOrchestrator] stream_result_starting_plain_completion')
      messages.push({ role: 'assistant', content: rawResponse.trim() })
      messages.push({ role: 'user', content: STREAM_RESULT_FOLLOW_UP_USER_MESSAGE })

      yield {
        type: 'status',
        message: await resolveUiStatusMessage({
          request: { phase: UiStatusPhase.draftingNaturalReply },
          userInstructionsBlock,
        }),
      }

      let streamed = ''
      try {
        for await (const delta of chat({
          model,
          messages,
          stream: true,
          think: false,
        })) {
          if (delta.length > 0) {
            streamed += delta
            assistantResponse += delta
            yield { type: 'chunk', content: delta }
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Streaming failed'
        logger.error({ error: errorMessage, step }, '[ToolOrchestrator] stream_result chat failed')
        yield { type: 'error', message: errorMessage }
        yield { type: 'done' }
        return
      }

      if (streamed.trim().length === 0) {
        for await (const chunk of streamAssistantUserReplyWithFallback({
          userInstructionsBlock,
          facts: { kind: 'orchestrator_surface_fallback', trigger: 'empty_stream_result' },
        })) {
          assistantResponse += chunk
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
    case 'unified':
      return UiStatusPhase.workerFocusUnified
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
    case 'summarize_context':
      return UiStatusPhase.toolSummarizeContext
    default:
      return UiStatusPhase.toolRunningUnknown
  }
}
