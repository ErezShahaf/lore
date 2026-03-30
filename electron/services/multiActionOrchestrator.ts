import { logger } from '../logger'
import { classifyInputUnified } from './unifiedClassifierService'
import { buildClassificationActionInput, executeClassificationAction } from './classificationActionExecutor'
import {
  getPendingCommandClarification,
  parseClarificationNumericReply,
} from './commandClarificationState'
import {
  clearPendingQuestionClarification,
  getPendingQuestionClarification,
  setConsumedQuestionFollowUp,
} from './questionClarificationState'
import { formatUserInstructionsBlock, loadAllUserInstructionDocuments } from './userInstructionsContext'
import { streamAssistantUserReplyWithFallback } from './assistantReplyComposer'
import { getSettings } from './settingsService'
import {
  resetUiStatusPhraseCacheForNewTurn,
  resolveUiStatusMessage,
  UiStatusPhase,
} from './uiStatusPhraseComposer'
import type {
  AgentEvent,
  ActionOutcome,
  ClassificationAction,
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

function mergeMultipleDeleteActionsForSingleCommandPass(
  actions: readonly ClassificationAction[],
  userInput: string,
): ClassificationAction[] {
  if (actions.length <= 1) {
    return [...actions]
  }
  if (!actions.every((action) => action.intent === 'delete')) {
    return [...actions]
  }
  const tagSet = new Set<string>()
  let extractedDate: string | null = null
  for (const action of actions) {
    for (const tag of action.extractedTags) {
      tagSet.add(tag)
    }
    if (extractedDate === null && action.extractedDate !== null) {
      extractedDate = action.extractedDate
    }
  }
  const first = actions[0]
  if (first === undefined) {
    return [...actions]
  }
  return [
    {
      intent: 'delete',
      data: userInput.trim(),
      extractedDate,
      extractedTags: [...tagSet],
      situationSummary: first.situationSummary,
      saveDocumentType: null,
    },
  ]
}

export async function* runMultiActionTurn(
  userInput: string,
  priorHistory: readonly ConversationEntry[],
  traceSink: MutablePipelineTraceSink | null = null,
  priorTurnRetrievedContextBlock: string | null = null,
): AsyncGenerator<AgentEvent> {
  resetUiStatusPhraseCacheForNewTurn()

  const userInstructionDocuments = await loadAllUserInstructionDocuments()
  const userInstructionsBlock = formatUserInstructionsBlock(userInstructionDocuments)

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

  let classification
  try {
    classification = await classifyInputUnified(
      userInput,
      priorHistory,
      userInstructionsBlock,
      priorTurnRetrievedContextBlock,
    )
  } catch (err) {
    logger.error({ err }, '[MultiActionOrchestrator] Classification failed')
    yield { type: 'error', message: toErrorMessage(err) }
    yield { type: 'done' }
    return
  }

  if (traceSink) {
    traceSink.stages.push({
      stageId: 'unified_classifier',
      ordinal: traceSink.stages.length,
      timestamp: new Date().toISOString(),
      output: { actions: classification.actions.map((action) => ({ ...action })) },
    })
  }

  const pendingGate = getPendingCommandClarification()

  const numericFollowUp = parseClarificationNumericReply(userInput.trim())
  let actions = classification.actions
  if (
    pendingGate !== null
    && numericFollowUp !== null
    && numericFollowUp >= 1
    && numericFollowUp <= pendingGate.candidateDocumentIds.length
  ) {
    const todoScoped = pendingGate.retrievalOptions?.type === 'todo'
    actions = [
      {
        intent: pendingGate.commandIntent,
        data: userInput,
        extractedDate: null,
        extractedTags: todoScoped ? ['todo'] : [],
        situationSummary: 'User chose a number from the prior clarification list.',
        saveDocumentType: null,
      },
    ]
  }

  const pendingQuestion = getPendingQuestionClarification()
  const questionFollowUpNumeric = parseClarificationNumericReply(userInput.trim())
  const pendingQuestionCandidateCount = pendingQuestion?.candidateDocumentIds.length ?? 0
  if (
    pendingQuestion !== null
    && questionFollowUpNumeric !== null
    && questionFollowUpNumeric >= 1
    && questionFollowUpNumeric <= pendingQuestionCandidateCount
  ) {
    clearPendingQuestionClarification()
    const mergedUserInput = `${pendingQuestion.priorUserInput}\n${userInput}`.trim()
    setConsumedQuestionFollowUp({
      priorUserInput: pendingQuestion.priorUserInput,
      followUpInput: userInput.trim(),
      mergedUserInput,
      candidateDocumentIds: pendingQuestion.candidateDocumentIds,
      classificationSnapshot: pendingQuestion.classificationSnapshot,
    })
    actions = [
      {
        intent: 'read',
        data: mergedUserInput,
        extractedDate: pendingQuestion.classificationSnapshot.extractedDate,
        extractedTags: [...pendingQuestion.classificationSnapshot.extractedTags],
        situationSummary: 'User chose a number from the prior question clarification list.',
        saveDocumentType: null,
      },
    ]
  } else if (pendingQuestion !== null) {
    clearPendingQuestionClarification()
  }

  actions = mergeMultipleDeleteActionsForSingleCommandPass(actions, userInput)

  logger.debug(
    { actionCount: actions.length, intents: actions.map((action) => action.intent) },
    '[MultiActionOrchestrator] Classified',
  )

  const outcomes: ActionOutcome[] = []
  const historyForHandlers = [...priorHistory]
  let streamedSpeakChunksForLastAction = false

  for (let index = 0; index < actions.length; index += 1) {
    const action = actions[index]
    const actionInput = buildClassificationActionInput(action, userInput)

    yield {
      type: 'status',
      message: await resolveUiStatusMessage({
        request: {
          phase: UiStatusPhase.multiActionStep,
          intent: action.intent,
          stepIndex: index,
          totalSteps: actions.length,
        },
        userInstructionsBlock,
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
      originalUserMessage: userInput,
      totalActionsInTurn: actions.length,
      priorTurnRetrievedContextBlock,
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

  const singleOutcome = outcomes.length === 1 ? outcomes[0] : undefined
  const isSingleDuplicateSaveClarification =
    singleOutcome !== undefined
    && singleOutcome.duplicateSaveClarificationPending
    && singleOutcome.message.trim().length > 0
  if (isSingleDuplicateSaveClarification) {
    const passthroughMessage = singleOutcome.message
    if (traceSink) {
      const multiActionFacts = {
        kind: 'multi_action_summary' as const,
        turnUserMessage: userInput,
        outcomes,
      }
      traceSink.stages.push({
        stageId: 'assistant_reply_composer',
        ordinal: traceSink.stages.length,
        timestamp: new Date().toISOString(),
        output: {
          factsKind: multiActionFacts.kind,
          facts: multiActionFacts,
          composedReplyPreview: truncateForPipelineTrace(
            passthroughMessage,
            PIPELINE_COMPOSED_REPLY_PREVIEW_MAX_CHARS,
          ),
          modelLabel: null,
        },
      })
    }
    yield { type: 'chunk', content: passthroughMessage }
    yield { type: 'done' }
    return
  }

  const isSingleCommandTargetClarification =
    singleOutcome !== undefined
    && singleOutcome.commandTargetClarificationPending
    && singleOutcome.message.trim().length > 0
  if (isSingleCommandTargetClarification) {
    const passthroughMessage = singleOutcome.message
    if (traceSink) {
      const multiActionFacts = {
        kind: 'multi_action_summary' as const,
        turnUserMessage: userInput,
        outcomes,
      }
      traceSink.stages.push({
        stageId: 'assistant_reply_composer',
        ordinal: traceSink.stages.length,
        timestamp: new Date().toISOString(),
        output: {
          factsKind: multiActionFacts.kind,
          facts: multiActionFacts,
          composedReplyPreview: truncateForPipelineTrace(
            passthroughMessage,
            PIPELINE_COMPOSED_REPLY_PREVIEW_MAX_CHARS,
          ),
          modelLabel: null,
        },
      })
    }
    yield { type: 'chunk', content: passthroughMessage }
    yield { type: 'done' }
    return
  }

  yield {
    type: 'status',
    message: await resolveUiStatusMessage({
      request: { phase: UiStatusPhase.summarizingTurn },
      userInstructionsBlock,
    }),
  }

  const multiActionFacts = {
    kind: 'multi_action_summary' as const,
    turnUserMessage: userInput,
    outcomes,
  }
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
