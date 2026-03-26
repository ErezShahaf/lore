import { logger } from '../logger'
import { classifyInputUnified } from './unifiedClassifierService'
import {
  buildClassificationActionInput,
  classificationIntentStatusLabel,
  executeClassificationAction,
} from './classificationActionExecutor'
import { formatUserInstructionsBlock, loadAllUserInstructionDocuments } from './userInstructionsContext'
import { streamAssistantUserReplyWithFallback } from './assistantReplyComposer'
import { getSettings } from './settingsService'
import type {
  AgentEvent,
  ActionOutcome,
  ConversationEntry,
  MutablePipelineTraceSink,
  PipelineActionExecutionTraceOutput,
} from '../../shared/types'

const PIPELINE_MESSAGE_PREVIEW_MAX_CHARS = 500
const PIPELINE_COMPOSED_REPLY_PREVIEW_MAX_CHARS = 800

function truncateForPipelineTrace(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text
  }
  return `${text.slice(0, Math.max(0, maxChars - 3))}...`
}

function outcomeToTraceOutput(
  actionIndex: number,
  outcome: ActionOutcome,
): PipelineActionExecutionTraceOutput {
  return {
    actionIndex,
    intent: outcome.intent,
    status: outcome.status,
    handlerResultSummary: outcome.handlerResultSummary,
    storedDocumentIds: outcome.storedDocumentIds,
    retrievedDocumentIds: outcome.retrievedDocumentIds,
    deletedDocumentCount: outcome.deletedDocumentCount,
    messagePreview: truncateForPipelineTrace(outcome.message, PIPELINE_MESSAGE_PREVIEW_MAX_CHARS),
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected error occurred'
}

export async function* runMultiActionTurn(
  userInput: string,
  priorHistory: readonly ConversationEntry[],
  traceSink: MutablePipelineTraceSink | null = null,
): AsyncGenerator<AgentEvent> {
  yield { type: 'status', message: 'Working on your message…' }

  const userInstructionDocuments = await loadAllUserInstructionDocuments()
  const userInstructionsBlock = formatUserInstructionsBlock(userInstructionDocuments)

  yield { type: 'status', message: 'Figuring out what you need…' }

  let classification
  try {
    classification = await classifyInputUnified(userInput, priorHistory, userInstructionsBlock)
  } catch (err) {
    logger.error({ err }, '[MultiActionOrchestrator] Classification failed')
    yield { type: 'error', message: toErrorMessage(err) }
    yield { type: 'done' }
    return
  }

  const actions = classification.actions
  logger.debug({ actionCount: actions.length, intents: actions.map((a) => a.intent) }, '[MultiActionOrchestrator] Classified')

  if (traceSink) {
    traceSink.stages.push({
      stageId: 'unified_classifier',
      ordinal: traceSink.stages.length,
      timestamp: new Date().toISOString(),
      output: { actions: classification.actions.map((action) => ({ ...action })) },
    })
  }

  const outcomes: ActionOutcome[] = []
  const historyForHandlers = [...priorHistory]
  let streamedSpeakChunksForLastAction = false

  for (let index = 0; index < actions.length; index += 1) {
    const action = actions[index]
    const actionInput = buildClassificationActionInput(action, userInput, actions.length)

    yield {
      type: 'status',
      message: classificationIntentStatusLabel(action.intent, {
        actionIndex: index,
        totalActions: actions.length,
      }),
    }

    streamedSpeakChunksForLastAction = false

    const executor = executeClassificationAction({
      action,
      actionInput,
      actionIndex: index,
      conversationHistory: historyForHandlers,
      userInstructionDocuments,
      userInstructionsBlock,
    })

    let step = await executor.next()
    while (!step.done) {
      const event = step.value
      if (event.type === 'chunk' && action.intent === 'speak') {
        streamedSpeakChunksForLastAction = true
      }
      yield event
      step = await executor.next()
    }

    const outcome = step.value
    outcomes.push(outcome)

    if (traceSink) {
      traceSink.stages.push({
        stageId: 'action_execution',
        ordinal: traceSink.stages.length,
        timestamp: new Date().toISOString(),
        output: outcomeToTraceOutput(index, outcome),
      })
    }
  }

  if (outcomes.length === 0) {
    yield { type: 'done' }
    return
  }

  const isSingleSpeak =
    outcomes.length === 1 && outcomes[0].intent === 'speak' && outcomes[0].message.length > 0
  if (isSingleSpeak) {
    if (!streamedSpeakChunksForLastAction) {
      yield { type: 'chunk', content: outcomes[0].message }
    }
    yield { type: 'done' }
    return
  }

  yield { type: 'status', message: 'Summarizing everything for you…' }

  const multiActionFacts = { kind: 'multi_action_summary' as const, outcomes }
  let composedReplyAccumulated = ''

  for await (const chunk of streamAssistantUserReplyWithFallback({
    userInstructionsBlock,
    facts: multiActionFacts,
  })) {
    composedReplyAccumulated += chunk
    yield { type: 'chunk', content: chunk }
  }

  if (traceSink) {
    const settings = getSettings()
    traceSink.stages.push({
      stageId: 'assistant_reply_composer',
      ordinal: traceSink.stages.length,
      timestamp: new Date().toISOString(),
      output: {
        factsKind: multiActionFacts.kind,
        facts: multiActionFacts,
        composedReplyPreview: truncateForPipelineTrace(
          composedReplyAccumulated,
          PIPELINE_COMPOSED_REPLY_PREVIEW_MAX_CHARS,
        ),
        modelLabel: settings.selectedModel,
      },
    })
  }

  yield { type: 'done' }
}
