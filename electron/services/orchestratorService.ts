/**
 * @deprecated The main flow now uses toolOrchestrator (orchestratorTools + toolOrchestrator).
 * This classification-based orchestrator is kept for potential rollback or reference.
 */
import { classificationIntentStatusLabel } from './classificationActionExecutor'
import { classifyInputWithStatusEvents } from './classifierService'
import { logger } from '../logger'
import { handleThought } from './handlers/thoughtHandler'
import { handleQuestion } from './handlers/questionHandler'
import { handleCommand } from './handlers/commandHandler'
import { handleConversational } from './handlers/conversationalHandler'
import { retrieveRelevantDocuments } from './documentPipeline'
import { formatUserInstructionsBlock, loadAllUserInstructionDocuments } from './userInstructionsContext'
import {
  ORCHESTRATOR_MAX_STEPS,
  type AgentEvent,
  type ClassificationAction,
  type ClassificationResult,
  type ConversationEntry,
  type OrchestratorTurnResult,
  primaryClassificationAction,
} from '../../shared/types'

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected error occurred'
}

function recordDispatcher(turn: OrchestratorTurnResult, dispatcherId: string): void {
  turn.completedDispatcherIds = [...turn.completedDispatcherIds, dispatcherId]
}

/**
 * Single entry point for routing after classification. Code owns the loop; handlers stay unchanged.
 * Future: additional `stepIndex` iterations (e.g. empty retrieval → clarify or re-classify).
 */
export async function* runOrchestratedTurn(
  userInput: string,
  priorHistory: readonly ConversationEntry[],
  turn: OrchestratorTurnResult,
): AsyncGenerator<AgentEvent> {
  for (let stepIndex = 0; stepIndex < ORCHESTRATOR_MAX_STEPS; stepIndex += 1) {
    if (stepIndex === 0) {
      yield { type: 'status', message: 'Working on your message…' }

      const userInstructionDocuments = await loadAllUserInstructionDocuments()
      turn.userInstructionDocuments = userInstructionDocuments
      turn.userInstructionsBlock = formatUserInstructionsBlock(userInstructionDocuments)

      let classification: ClassificationResult
      try {
        const iterator = classifyInputWithStatusEvents(userInput, priorHistory, turn.userInstructionsBlock)
        let step = await iterator.next()
        while (!step.done) {
          yield step.value as AgentEvent
          step = await iterator.next()
        }
        classification = step.value as ClassificationResult
      } catch (err) {
        logger.error({ err }, '[Orchestrator] Classification failed')
        yield { type: 'error', message: toErrorMessage(err) }
        yield { type: 'done' }
        return
      }

      turn.classification = classification

      const primaryAction = primaryClassificationAction(classification)

      logger.debug(
        {
          intent: primaryAction.intent,
          stepIndex,
        },
        '[Orchestrator] Classified',
      )

      yield {
        type: 'status',
        message: classificationIntentStatusLabel(primaryAction.intent, null),
      }

      yield* dispatchIntentHandlers(userInput, priorHistory, primaryAction, turn)
      return
    }

    // Reserved for multi-step orchestration (e.g. post-retrieval branch).
    break
  }

  yield { type: 'done' }
}

async function* dispatchIntentHandlers(
  userInput: string,
  priorHistory: readonly ConversationEntry[],
  classification: ClassificationAction,
  turn: OrchestratorTurnResult,
): AsyncGenerator<AgentEvent> {
  try {
    switch (classification.intent) {
      case 'save': {
        yield { type: 'status', message: 'Saving or updating your note…' }
        turn.lastDocumentIds = []
        recordDispatcher(turn, 'ThoughtHandler')
        for await (const event of handleThought(
          userInput,
          classification,
          priorHistory,
          turn.userInstructionsBlock,
          userInput,
        )) {
          if (event.type === 'chunk') turn.assistantResponse += event.content
          if (event.type === 'stored') turn.lastDocumentIds.push(event.documentId)
          if (event.type !== 'turn_step_summary' && event.type !== 'read_retrieval_context') {
            yield event
          }
        }
        break
      }
      case 'read': {
        yield { type: 'status', message: 'Looking through your library to answer you…' }
        turn.lastDocumentIds = []
        const isTodoQuery = classification.extractedTags.some((tag) => tag === 'todo')
        const todoOverrides = isTodoQuery ? ({ type: 'todo' } as const) : undefined
        recordDispatcher(turn, 'QuestionHandler')
        for await (const event of handleQuestion(
          userInput,
          classification,
          [...priorHistory],
          todoOverrides,
          turn.userInstructionDocuments,
          turn.userInstructionsBlock,
        )) {
          if (event.type === 'chunk') turn.assistantResponse += event.content
          if (event.type === 'retrieved') turn.lastDocumentIds = [...event.documentIds]
          if (event.type !== 'turn_step_summary' && event.type !== 'read_retrieval_context') {
            yield event
          }
        }
        break
      }
      case 'edit':
      case 'delete': {
        yield { type: 'status', message: 'Applying changes to your stored notes…' }
        recordDispatcher(turn, 'CommandHandler')
        for await (const event of handleCommand(userInput, classification, priorHistory, undefined, turn.userInstructionsBlock)) {
          if (event.type === 'chunk') turn.assistantResponse += event.content
          if (event.type === 'retrieved') turn.lastDocumentIds = [...event.documentIds]
          if (event.type !== 'turn_step_summary' && event.type !== 'read_retrieval_context') {
            yield event
          }
        }
        break
      }
      case 'speak': {
        yield { type: 'status', message: 'Checking your saved instructions for anything relevant…' }
        const relevantInstructions = await retrieveRelevantDocuments(userInput, {
          type: 'instruction',
          similarityThreshold: 0.8,
        })

        if (relevantInstructions.length > 0) {
          yield {
            type: 'status',
            message: 'Something you saved fits this—answering from your notes…',
          }
          turn.lastDocumentIds = []
          recordDispatcher(turn, 'QuestionHandlerViaInstructions')
          for await (const event of handleQuestion(
            userInput,
            classification,
            [...priorHistory],
            undefined,
            turn.userInstructionDocuments,
            turn.userInstructionsBlock,
          )) {
            if (event.type === 'chunk') turn.assistantResponse += event.content
            if (event.type === 'retrieved') turn.lastDocumentIds = [...event.documentIds]
            if (event.type !== 'turn_step_summary' && event.type !== 'read_retrieval_context') {
              yield event
            }
          }
        } else {
          yield { type: 'status', message: 'No saved rule applied—drafting a short reply…' }
          recordDispatcher(turn, 'ConversationalHandler')
          for await (const event of handleConversational(userInput, classification, priorHistory, turn.userInstructionsBlock)) {
            if (event.type === 'chunk') turn.assistantResponse += event.content
            if (event.type !== 'turn_step_summary' && event.type !== 'read_retrieval_context') {
              yield event
            }
          }
        }
        break
      }
    }
  } catch (err) {
    yield { type: 'error', message: toErrorMessage(err) }
    yield { type: 'done' }
  }
}

export function createEmptyOrchestratorTurn(): OrchestratorTurnResult {
  return {
    assistantResponse: '',
    classification: null,
    lastDocumentIds: [],
    completedDispatcherIds: [],
    userInstructionDocuments: [],
    userInstructionsBlock: '',
  }
}
