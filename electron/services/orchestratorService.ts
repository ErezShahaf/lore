import { classifyInputWithStatusEvents } from './classifierService'
import { logger } from '../logger'
import { handleThought } from './handlers/thoughtHandler'
import { handleQuestion } from './handlers/questionHandler'
import { handleCommand } from './handlers/commandHandler'
import { handleInstruction } from './handlers/instructionHandler'
import { handleConversational } from './handlers/conversationalHandler'
import { retrieveRelevantDocuments } from './documentPipeline'
import { formatUserInstructionsBlock, loadAllUserInstructionDocuments } from './userInstructionsContext'
import { getSettings } from './settingsService'
import { streamLowConfidenceOrchestratorReply } from './orchestratorClarificationReply'
import {
  ORCHESTRATOR_MAX_STEPS,
  type AgentEvent,
  type ClassificationResult,
  type ConversationEntry,
  type OrchestratorTurnResult,
} from '../../shared/types'

export const ORCHESTRATOR_CLASSIFICATION_CONFIDENCE_THRESHOLD = 0.75

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
      yield { type: 'status', message: 'Starting your turn…' }

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

      logger.debug(
        {
          intent: classification.intent,
          subtype: classification.subtype,
          confidence: classification.confidence,
          stepIndex,
        },
        '[Orchestrator] Classified',
      )

      if (classification.confidence < ORCHESTRATOR_CLASSIFICATION_CONFIDENCE_THRESHOLD) {
        logger.warn(
          { confidence: classification.confidence },
          '[Orchestrator] Confidence too low, drafting clarification via model',
        )
        recordDispatcher(turn, 'LowConfidenceGate')
        yield { type: 'status', message: 'Confidence was low—drafting a helpful reply…' }
        const settings = getSettings()
        try {
          for await (const chunk of streamLowConfidenceOrchestratorReply({
            userInput,
            userInstructionsBlock: turn.userInstructionsBlock,
            model: settings.selectedModel,
          })) {
            turn.assistantResponse += chunk
            yield { type: 'chunk', content: chunk }
          }
        } catch (err) {
          logger.error({ err }, '[Orchestrator] Low-confidence reply failed')
          yield { type: 'error', message: toErrorMessage(err) }
        }
        yield { type: 'done' }
        return
      }

      yield {
        type: 'status',
        message: `Orchestrator: routing to ${classification.intent}…`,
      }

      yield* dispatchIntentHandlers(userInput, priorHistory, classification, turn)
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
  classification: ClassificationResult,
  turn: OrchestratorTurnResult,
): AsyncGenerator<AgentEvent> {
  try {
    switch (classification.intent) {
      case 'thought': {
        yield { type: 'status', message: 'Thought path: saving or updating your note…' }
        turn.lastDocumentIds = []
        recordDispatcher(turn, 'ThoughtHandler')
        for await (const event of handleThought(userInput, classification, priorHistory, turn.userInstructionsBlock)) {
          if (event.type === 'chunk') turn.assistantResponse += event.content
          if (event.type === 'stored') turn.lastDocumentIds.push(event.documentId)
          yield event
        }
        break
      }
      case 'question': {
        yield { type: 'status', message: 'Question path: retrieving and answering from your library…' }
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
          yield event
        }
        break
      }
      case 'command': {
        yield { type: 'status', message: 'Command path: applying changes to stored documents…' }
        recordDispatcher(turn, 'CommandHandler')
        for await (const event of handleCommand(userInput, classification, priorHistory, undefined, turn.userInstructionsBlock)) {
          if (event.type === 'chunk') turn.assistantResponse += event.content
          if (event.type === 'retrieved') turn.lastDocumentIds = [...event.documentIds]
          yield event
        }
        break
      }
      case 'instruction': {
        yield { type: 'status', message: 'Instruction path: storing a standing preference…' }
        recordDispatcher(turn, 'InstructionHandler')
        for await (const event of handleInstruction(userInput, classification, turn.userInstructionsBlock)) {
          if (event.type === 'chunk') turn.assistantResponse += event.content
          if (event.type === 'stored') turn.lastDocumentIds = [event.documentId]
          yield event
        }
        break
      }
      case 'conversational': {
        yield { type: 'status', message: 'Conversational path: checking for relevant saved instructions…' }
        const relevantInstructions = await retrieveRelevantDocuments(userInput, {
          type: 'instruction',
          similarityThreshold: classification.subtype === 'greeting' ? 0.55 : 0.8,
        })

        if (relevantInstructions.length > 0) {
          yield {
            type: 'status',
            message: 'Instructions matched: switching to question-style retrieval and answer…',
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
            yield event
          }
        } else {
          yield { type: 'status', message: 'No instruction override: drafting a short reply…' }
          recordDispatcher(turn, 'ConversationalHandler')
          for await (const event of handleConversational(userInput, classification, priorHistory, turn.userInstructionsBlock)) {
            if (event.type === 'chunk') turn.assistantResponse += event.content
            yield event
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
