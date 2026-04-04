import { logger } from '../logger'
import { chat, collectChatResponse } from './ollamaService'
import { buildFallbackAssistantReply } from './assistantReplyComposer'
import {
  resetUiStatusPhraseCacheForNewTurn,
  resolveUiStatusMessage,
  UiStatusPhase,
} from './uiStatusPhraseComposer'
import {
  conversationHistoryToOrchestratorMessages,
  formatToolResultForNextMessage,
  formatValidAgentsHint,
  jsonRetryUserMessage,
  buildReplyStreamVerbatimFollowUp,
  parseOrchestratorAction,
  STREAM_RESULT_FOLLOW_UP_USER_MESSAGE,
} from './orchestratorJsonProtocol'
import { type OrchestratorToolContext } from './orchestratorTools'
import { executeOrchestratorToolWithHooks } from './toolHooks'
import {
  buildWorkerSystemPrompt,
  getToolsForWorker,
  loadProgressiveComposeSkillAddon,
  UNIFIED_NATIVE_IGNORED_CLASSIFICATION_PLACEHOLDER,
} from './workerRouter'
import { getSettings } from './settingsService'
import type { AgentEvent, ConversationEntry, MutablePipelineTraceSink } from '../../shared/types'
import { ORCHESTRATOR_MAX_STEPS } from '../../shared/types'

/** Native unified: skip a second streaming round for short confirmations (one chunk, no fake typing). */
const NATIVE_INLINE_REPLY_MAX_CHARS = 280

async function* streamNativeFinalMarkdownToUi(params: {
  readonly model: string
  readonly messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  readonly userInstructionsBlock: string
  readonly isCancelled: () => boolean
  readonly step: number
  readonly logLabel: string
  /** When set, prefer this trigger for empty-stream fallback (reply path vs stream_result). */
  readonly emptyStreamFallbackTrigger?: 'empty_stream_result' | 'empty_decision_reply'
}): AsyncGenerator<AgentEvent> {
  const {
    model,
    messages,
    userInstructionsBlock,
    isCancelled,
    step,
    logLabel,
    emptyStreamFallbackTrigger = 'empty_stream_result',
  } = params

  yield {
    type: 'status',
    message: await resolveUiStatusMessage({
      request: { phase: UiStatusPhase.draftingNaturalReply },
      userInstructionsBlock,
    }),
  }

  let streamed = ''
  for await (const delta of chat({
    model,
    messages,
    stream: true,
    think: false,
  })) {
    if (isCancelled()) {
      logger.debug({ step, logLabel }, '[TurnEngine] native_final_stream cancelled mid_stream')
      break
    }
    if (delta.length > 0) {
      streamed += delta
      yield { type: 'chunk', content: delta }
    }
  }

  if (streamed.trim().length === 0) {
    const fallbackText = buildFallbackAssistantReply({
      kind: 'orchestrator_surface_fallback',
      trigger: emptyStreamFallbackTrigger,
    })
    yield { type: 'chunk', content: fallbackText }
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
    case 'unified':
      return UiStatusPhase.workerFocusUnified
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
 * JSON-in-text orchestrator loop (same `call` / `reply` protocol as {@link runToolOrchestratedTurn})
 * with shared tool execution and pipeline traces. Does not use Ollama native `tool_calls`.
 */
export async function* runNativeToolLoopTurn(
  userInput: string,
  priorHistory: readonly ConversationEntry[],
  options: NativeToolLoopOptions,
): AsyncGenerator<AgentEvent> {
  const { traceSink, userInstructionsBlock, isCancelled, priorTurnRetrievedContextBlock } = options

  logger.debug(
    {
      userInputPreview: userInput.slice(0, 200),
      priorHistoryTurnCount: priorHistory.length,
      hasTraceSink: traceSink !== null,
      hasPriorTurnContextBlock:
        priorTurnRetrievedContextBlock !== null && priorTurnRetrievedContextBlock.trim().length > 0,
    },
    '[TurnEngine] Stage: turn_start',
  )

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
    logger.debug({}, '[TurnEngine] Stage: early_exit_cancelled_before_router')
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

  const workerKind = 'unified' as const
  logger.debug({ workerKind }, '[TurnEngine] Stage: unified_native_skip_classifier')

  if (traceSink) {
    traceSink.stages.push({
      stageId: 'turn_engine_router',
      ordinal: traceSink.stages.length,
      timestamp: new Date().toISOString(),
      output: { workerKind },
    })
  }

  logger.debug({ workerKind }, '[TurnEngine] Stage: pipeline_trace_router_recorded')

  yield {
    type: 'status',
    message: await resolveUiStatusMessage({
      request: { phase: workerKindToStatusPhase(workerKind) },
      userInstructionsBlock,
    }),
  }

  let systemPrompt = buildWorkerSystemPrompt(
    workerKind,
    userInstructionsBlock,
    UNIFIED_NATIVE_IGNORED_CLASSIFICATION_PLACEHOLDER,
    {
      workerToolOrchestrationProtocol: 'json_in_text',
    },
  )
  const progressiveAddon = loadProgressiveComposeSkillAddon(workerKind)
  if (progressiveAddon.trim().length > 0) {
    systemPrompt = `${systemPrompt}\n\n## Reply composition reference\n\n${progressiveAddon}`
  }

  const settings = getSettings()
  const model = settings.selectedModel
  const allowedToolNames = getToolsForWorker(workerKind)

  logger.debug(
    {
      model,
      workerKind,
      allowedToolCount: allowedToolNames.length,
      allowedToolNames: [...allowedToolNames],
      systemPromptCharCount: systemPrompt.length,
      progressiveAddonCharCount: progressiveAddon.trim().length,
    },
    '[TurnEngine] Stage: model_and_json_orchestrator_ready',
  )

  const context: OrchestratorToolContext = {
    userInput,
    priorHistory,
    userInstructionsBlock,
    documentsCache: new Map(),
    isUnifiedNativeAgent: true,
  }

  const jsonOrchestratorBaseMessages: Array<{
    role: 'system' | 'user' | 'assistant'
    content: string
  }> = [
    { role: 'system', content: systemPrompt },
    ...conversationHistoryToOrchestratorMessages(priorHistory),
  ]

  if (priorTurnRetrievedContextBlock !== null && priorTurnRetrievedContextBlock.trim().length > 0) {
    jsonOrchestratorBaseMessages.push({ role: 'user', content: priorTurnRetrievedContextBlock.trim() })
  }

  jsonOrchestratorBaseMessages.push({ role: 'user', content: userInput })

  logger.debug(
    { messageCount: jsonOrchestratorBaseMessages.length, workerKind },
    '[TurnEngine] Stage: chat_messages_built',
  )

  if (allowedToolNames.length === 0) {
    logger.debug({ workerKind, model }, '[TurnEngine] Stage: conversational_no_tools_branch_entered')
    const plainMessages = jsonOrchestratorBaseMessages.map((message) => ({
      role: message.role,
      content: message.content,
    }))
    try {
      let streamedLength = 0
      let chunkCount = 0
      for await (const delta of chat({
        model,
        messages: plainMessages,
        stream: true,
        think: false,
      })) {
        if (delta.length > 0) {
          streamedLength += delta.length
          chunkCount += 1
          yield { type: 'chunk', content: delta }
        }
      }
      logger.debug(
        { chunkCount, streamedLength },
        '[TurnEngine] Stage: conversational_stream_chunks_yielded',
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Chat failed'
      logger.error({ message }, '[TurnEngine] Conversational path failed')
      yield { type: 'error', message }
    }
    logger.debug({}, '[TurnEngine] Stage: conversational_branch_done_yielding_done')
    yield { type: 'done' }
    return
  }

  const validAgentNames = new Set(allowedToolNames)
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    ...jsonOrchestratorBaseMessages,
  ]

  logger.debug(
    { maxSteps: ORCHESTRATOR_MAX_STEPS },
    '[TurnEngine] Stage: native_tool_loop_entered',
  )

  for (let step = 0; step < ORCHESTRATOR_MAX_STEPS; step += 1) {
    if (isCancelled()) {
      logger.debug({ step }, '[TurnEngine] Stage: tool_loop_cancelled_mid_turn')
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

    logger.debug(
      {
        step,
        messageCount: messages.length,
        model,
      },
      '[TurnEngine] Stage: tool_loop_round_collect_chat',
    )

    let rawResponse: string
    try {
      rawResponse = await collectChatResponse({
        model,
        messages,
        stream: false,
        think: false,
        format: 'json',
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ollama chat failed'
      logger.error({ message, step }, '[TurnEngine] collectChatResponse failed')
      yield { type: 'error', message }
      yield { type: 'done' }
      return
    }

    const parsed = parseOrchestratorAction(rawResponse, validAgentNames)
    const preview = rawResponse.trim().slice(0, 400)
    const hadToolCalls = parsed !== null && parsed.action === 'call'
    const toolNamesForTrace =
      parsed !== null && parsed.action === 'call' ? [parsed.agent] : ([] as const)

    if (traceSink) {
      traceSink.stages.push({
        stageId: 'turn_engine_native_round',
        ordinal: traceSink.stages.length,
        timestamp: new Date().toISOString(),
        output: {
          loopStep: step,
          hadToolCalls,
          toolNames: toolNamesForTrace,
          stopReason:
            parsed === null
              ? 'invalid_json_retry'
              : parsed.action === 'call'
                ? 'tool_round'
                : parsed.action === 'stream_result'
                  ? 'stream_result'
                  : 'model_reply',
          assistantPreview: preview,
        },
      })
    }

    logger.debug(
      {
        step,
        hadToolCalls,
        toolCallCount: hadToolCalls ? 1 : 0,
        toolNames: [...toolNamesForTrace],
        stopReason:
          parsed === null
            ? 'invalid_json_retry'
            : parsed.action === 'call'
              ? 'tool_round'
              : parsed.action === 'stream_result'
                ? 'stream_result'
                : 'model_reply',
        assistantContentLength: rawResponse.length,
        assistantPreview: preview,
      },
      '[TurnEngine] Stage: tool_loop_round_outcome_recorded',
    )

    if (parsed === null) {
      logger.warn(
        { step, rawPreview: rawResponse.slice(0, 300), messageCount: messages.length },
        '[TurnEngine] Failed to parse orchestrator JSON action',
      )
      messages.push({
        role: 'user',
        content: jsonRetryUserMessage(workerKind, validAgentNames),
      })
      continue
    }

    if (parsed.action === 'reply') {
      const trimmedReply = parsed.content.trim()
      logger.debug(
        { step, assistantContentLength: trimmedReply.length },
        '[TurnEngine] Stage: tool_loop_end_reply_yielding_done',
      )
      if (trimmedReply.length === 0) {
        yield {
          type: 'chunk',
          content: buildFallbackAssistantReply({
            kind: 'orchestrator_surface_fallback',
            trigger: 'empty_decision_reply',
          }),
        }
        yield { type: 'done' }
        return
      }

      if (trimmedReply.length <= NATIVE_INLINE_REPLY_MAX_CHARS) {
        yield { type: 'chunk', content: trimmedReply }
        yield { type: 'done' }
        return
      }

      logger.debug({ step }, '[TurnEngine] Stage: reply_long_starting_plain_stream')
      messages.push({ role: 'assistant', content: rawResponse.trim() })
      messages.push({ role: 'user', content: buildReplyStreamVerbatimFollowUp(trimmedReply) })
      try {
        yield* streamNativeFinalMarkdownToUi({
          model,
          messages,
          userInstructionsBlock,
          isCancelled,
          step,
          logLabel: 'reply_stream',
          emptyStreamFallbackTrigger: 'empty_decision_reply',
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Streaming failed'
        logger.error({ message, step }, '[TurnEngine] reply_stream chat failed')
        yield { type: 'error', message }
        yield { type: 'done' }
        return
      }
      yield { type: 'done' }
      return
    }

    if (parsed.action === 'stream_result') {
      logger.debug({ step }, '[TurnEngine] Stage: stream_result_starting_plain_completion')
      messages.push({ role: 'assistant', content: rawResponse.trim() })
      messages.push({ role: 'user', content: STREAM_RESULT_FOLLOW_UP_USER_MESSAGE })
      try {
        yield* streamNativeFinalMarkdownToUi({
          model,
          messages,
          userInstructionsBlock,
          isCancelled,
          step,
          logLabel: 'stream_result',
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Streaming failed'
        logger.error({ message, step }, '[TurnEngine] stream_result chat failed')
        yield { type: 'error', message }
        yield { type: 'done' }
        return
      }
      yield { type: 'done' }
      return
    }

    if (!validAgentNames.has(parsed.agent)) {
      logger.warn(
        { agent: parsed.agent, validAgents: [...validAgentNames], workerKind, step },
        '[TurnEngine] Unknown or disallowed agent for worker',
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

    const toolName = parsed.agent
    const toolArguments = parsed.params ?? {}

    logger.debug(
      {
        step,
        toolName,
        argumentsPreview: JSON.stringify(toolArguments).slice(0, 300),
      },
      '[TurnEngine] Stage: tool_execution_start',
    )
    yield {
      type: 'status',
      message: await resolveUiStatusMessage({
        request: { phase: toolAgentToStatusPhase(toolName), toolAgent: toolName },
        userInstructionsBlock,
      }),
    }

    const result = await executeOrchestratorToolWithHooks(toolName, toolArguments, context)

    logger.debug(
      {
        step,
        toolName,
        outputCharCount: result.output.length,
        sideEffectEventCount: result.events.length,
      },
      '[TurnEngine] Stage: tool_execution_complete',
    )

    for (const agentEvent of result.events) {
      if (agentEvent.type !== 'chunk' && agentEvent.type !== 'turn_step_summary') {
        yield agentEvent
      }
    }

    messages.push({
      role: 'assistant',
      content: JSON.stringify({ action: 'call', agent: parsed.agent, params: toolArguments }),
    })
    messages.push({
      role: 'user',
      content: formatToolResultForNextMessage(toolName, result.output, {
        markToolOutputAsUntrusted: true,
      }),
    })

    logger.debug(
      { step, messageCountAfterTools: messages.length },
      '[TurnEngine] Stage: tool_loop_round_complete_continuing',
    )
  }

  logger.debug({}, '[TurnEngine] Stage: tool_loop_exhausted_max_steps')
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

  logger.debug({}, '[TurnEngine] Stage: max_rounds_fallback_reply_start')
  const maxStepsFallback = buildFallbackAssistantReply({
    kind: 'orchestrator_surface_fallback',
    trigger: 'max_steps_exhausted',
  })
  yield { type: 'chunk', content: maxStepsFallback }
  logger.debug(
    { fallbackCharCount: maxStepsFallback.length },
    '[TurnEngine] Stage: max_rounds_fallback_reply_done',
  )
  logger.debug({}, '[TurnEngine] Stage: turn_complete_yielding_done')
  yield { type: 'done' }
}
