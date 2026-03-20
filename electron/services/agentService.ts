import { classifyInput } from './classifierService'
import { logger } from '../logger'
import { handleThought } from './handlers/thoughtHandler'
import { handleQuestion } from './handlers/questionHandler'
import { handleCommand } from './handlers/commandHandler'
import { handleInstruction } from './handlers/instructionHandler'
import { handleConversational } from './handlers/conversationalHandler'
import {
  looksLikeClarificationFollowUp,
  looksLikeBehaviorPreferenceInstruction,
  looksLikeExplicitStorageRequest,
  looksLikeExplicitModificationRequest,
  looksLikeInstructionManagementRequest,
  looksLikeQuestionRequest,
  looksLikeRawStructuredDataInput,
  looksLikeReferentialCommandRequest,
  looksLikeSelfReportedCompletion,
  looksLikeShortReaction,
  looksLikeStoredDataQuestion,
  looksLikeTodoQuery,
  looksLikeVagueImperativeRequest,
} from './userIntentHeuristics'
import type {
  AgentEvent,
  ConversationEntry,
  InputClassification,
  RetrievalOptions,
} from '../../shared/types'

interface SessionContext {
  history: ConversationEntry[]
  lastDocumentIds: string[]
  lastTopic: string | null
  lastIntent: InputClassification | null
}

let session: SessionContext = {
  history: [],
  lastDocumentIds: [],
  lastTopic: null,
  lastIntent: null,
}

export function clearConversation(): void {
  session = {
    history: [],
    lastDocumentIds: [],
    lastTopic: null,
    lastIntent: null,
  }
}

export function getConversationHistory(): ConversationEntry[] {
  return session.history
}

// ── Confidence thresholds ─────────────────────────────────────

const CLASSIFICATION_CONFIDENCE_THRESHOLD = 0.75

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected error occurred'
}

export function applyDeterministicRoutingHints(
  userInput: string,
  classification: {
    intent: 'thought' | 'question' | 'command' | 'instruction' | 'conversational'
    subtype: string
    confidence: number
    reasoning: string
  },
  conversationHistory: readonly ConversationEntry[] = [],
): void {
  if (
    classification.intent !== 'command'
    && classification.intent !== 'instruction'
    && !looksLikeExplicitStorageRequest(userInput)
    && !looksLikeExplicitModificationRequest(userInput)
    && (looksLikeStoredDataQuestion(userInput) || looksLikeQuestionRequest(userInput))
  ) {
    classification.intent = 'question'
    classification.confidence = Math.max(classification.confidence, CLASSIFICATION_CONFIDENCE_THRESHOLD)
    classification.reasoning = 'Heuristic override: question-like request should use the retrieval pipeline.'
  }

  if (
    !looksLikeInstructionManagementRequest(userInput)
    && looksLikeBehaviorPreferenceInstruction(userInput)
    && !looksLikeExplicitModificationRequest(userInput)
  ) {
    classification.intent = 'instruction'
    classification.subtype = 'general'
    classification.confidence = Math.max(classification.confidence, CLASSIFICATION_CONFIDENCE_THRESHOLD)
    classification.reasoning = 'Heuristic override: persistent behavior preference should be saved as an instruction.'
  }

  if (classification.intent === 'instruction' && looksLikeInstructionManagementRequest(userInput)) {
    classification.intent = 'command'
    classification.confidence = Math.max(classification.confidence, CLASSIFICATION_CONFIDENCE_THRESHOLD)
    classification.reasoning = 'Heuristic override: instruction management request should use the command pipeline.'
  }

  if (
    classification.intent === 'command'
    && looksLikeExplicitStorageRequest(userInput)
    && !looksLikeExplicitModificationRequest(userInput)
  ) {
    classification.intent = 'thought'
    classification.subtype = 'general'
    classification.confidence = Math.max(classification.confidence, CLASSIFICATION_CONFIDENCE_THRESHOLD)
    classification.reasoning = 'Heuristic override: explicit storage request should create new stored items.'
  }

  if (
    classification.intent === 'thought'
    && looksLikeShortReaction(userInput)
    && !looksLikeExplicitStorageRequest(userInput)
  ) {
    classification.intent = 'conversational'
    classification.confidence = Math.max(classification.confidence, CLASSIFICATION_CONFIDENCE_THRESHOLD)
    classification.reasoning = 'Heuristic override: short reaction-like input should not be stored by default.'
  }

  if (looksLikeVagueImperativeRequest(userInput)) {
    classification.confidence = Math.min(classification.confidence, 0.35)
    classification.reasoning = 'Heuristic override: vague imperative request lacks enough detail to act safely.'
  }

  if (
    (classification.intent === 'thought' || classification.intent === 'conversational')
    && looksLikeSelfReportedCompletion(userInput)
    && session.lastDocumentIds.length > 0
  ) {
    classification.intent = 'command'
    classification.subtype = 'delete'
    classification.confidence = Math.max(classification.confidence, CLASSIFICATION_CONFIDENCE_THRESHOLD)
    classification.reasoning = 'Heuristic override: self-reported completion after task context should try the command pipeline.'
  }

  const lastAssistantMessage = [...conversationHistory]
    .reverse()
    .find((entry) => entry.role === 'assistant')
    ?.content

  if (
    lastAssistantMessage
    && lastAssistantAskedForClarification(lastAssistantMessage)
    && looksLikeClarificationFollowUp(userInput)
    && session.lastIntent !== null
  ) {
    classification.intent = session.lastIntent
    classification.subtype = 'general'
    classification.confidence = Math.max(classification.confidence, CLASSIFICATION_CONFIDENCE_THRESHOLD)
    classification.reasoning = 'Heuristic override: clarification follow-up should stay on the previous intent.'
  }
}

// ── Main processing loop ─────────────────────────────────────

export async function* processUserInput(userInput: string): AsyncGenerator<AgentEvent> {
  const priorHistory = session.history.slice()
  session.history.push({ role: 'user', content: userInput })

  yield { type: 'status', message: 'Classifying your input...' }

  let classification
  try {
    classification = await classifyInput(userInput, priorHistory)
  } catch (err) {
    logger.error({ err }, '[Agent] Classification failed')
    yield { type: 'error', message: toErrorMessage(err) }
    yield { type: 'done' }
    return
  }

  applyDeterministicRoutingHints(userInput, classification, priorHistory)

  if (
    looksLikeRawStructuredDataInput(userInput)
    && !looksLikeExplicitStorageRequest(userInput)
    && !looksLikeExplicitModificationRequest(userInput)
    && !looksLikeStoredDataQuestion(userInput)
  ) {
    const clarificationResponse = buildStructuredDataClarificationResponse(userInput)
    yield { type: 'chunk', content: clarificationResponse }
    yield { type: 'done' }
    session.history.push({ role: 'assistant', content: clarificationResponse })
    session.lastIntent = 'conversational'
    return
  }

  logger.debug(
    { intent: classification.intent, subtype: classification.subtype, confidence: classification.confidence },
    '[Agent] Classified',
  )

  if (classification.confidence < CLASSIFICATION_CONFIDENCE_THRESHOLD) {
    logger.warn({ confidence: classification.confidence }, '[Agent] Classification confidence too low, refusing to act')
    const lowConfidenceResponse =
      "I'm not sure what you'd like me to do. Could you provide more detail or rephrase? " +
      'You can also ask me "what can you do?" to learn about my capabilities.'
    yield { type: 'chunk', content: lowConfidenceResponse }
    yield { type: 'done' }
    session.history.push({ role: 'assistant', content: lowConfidenceResponse })
    return
  }

  let assistantResponse = ''

  try {
    switch (classification.intent) {
        case 'thought': {
          const storedDocumentIds: string[] = []
          for await (const event of handleThought(userInput, classification, priorHistory)) {
            if (event.type === 'chunk') assistantResponse += event.content
            if (event.type === 'stored') storedDocumentIds.push(event.documentId)
            yield event
          }
          session.lastDocumentIds = storedDocumentIds
          break
        }
        case 'question': {
          session.lastDocumentIds = []
          const isTodoQuery = looksLikeTodoQuery(userInput)
            || classification.extractedTags.some((tag) => tag.toLowerCase() === 'todo')
          const todoOverrides: RetrievalOptions | undefined = isTodoQuery
            ? { type: 'todo' }
            : undefined
          for await (const event of handleQuestion(userInput, classification, priorHistory, todoOverrides)) {
            if (event.type === 'chunk') assistantResponse += event.content
            if (event.type === 'retrieved') session.lastDocumentIds = [...event.documentIds]
            yield event
          }
          break
        }
        case 'command': {
          const commandOverrides: RetrievalOptions | undefined = getCommandRetrievalOverrides(userInput)
          for await (const event of handleCommand(userInput, classification, priorHistory, commandOverrides)) {
            if (event.type === 'chunk') assistantResponse += event.content
            if (event.type === 'retrieved') session.lastDocumentIds = [...event.documentIds]
            yield event
          }
          break
        }
        case 'instruction': {
          for await (const event of handleInstruction(userInput, classification)) {
            if (event.type === 'chunk') assistantResponse += event.content
            if (event.type === 'stored') session.lastDocumentIds = [event.documentId]
            yield event
          }
          break
        }
        case 'conversational': {
          for await (const event of handleConversational(userInput, classification, priorHistory)) {
            if (event.type === 'chunk') assistantResponse += event.content
            yield event
          }
          break
        }
    }
  } catch (err) {
    yield { type: 'error', message: toErrorMessage(err) }
    yield { type: 'done' }
    return
  }

  if (assistantResponse) {
    session.history.push({ role: 'assistant', content: assistantResponse })
  }

  if (classification.extractedTags.length > 0) {
    session.lastTopic = classification.extractedTags[0]
  }

  session.lastIntent = classification.intent
}

function getCommandRetrievalOverrides(userInput: string): RetrievalOptions | undefined {
  if (looksLikeInstructionManagementRequest(userInput)) {
    return { type: 'instruction' }
  }

  if (session.lastIntent === 'question' && looksLikeReferentialCommandRequest(userInput) && session.lastDocumentIds.length > 0) {
    return {
      ids: [...session.lastDocumentIds],
      maxResults: session.lastDocumentIds.length,
    }
  }

  if (
    session.lastIntent === 'command'
    && session.lastDocumentIds.length > 0
    && (looksLikeReferentialCommandRequest(userInput) || looksLikeClarificationFollowUp(userInput))
  ) {
    return {
      ids: [...session.lastDocumentIds],
      maxResults: session.lastDocumentIds.length,
    }
  }

  if (session.lastIntent === 'instruction' && looksLikeReferentialCommandRequest(userInput)) {
    return { type: 'instruction' }
  }

  return undefined
}

function lastAssistantAskedForClarification(message: string): boolean {
  return /\bwhich one did you mean\b/i.test(message)
    || /\bwhich one\b/i.test(message)
    || /\bwhich document\b/i.test(message)
    || /\bmultiple matches\b/i.test(message)
    || /\bi found (?:a few|multiple)\b/i.test(message)
    || /\bcould you be more specific\b/i.test(message)
}

function buildStructuredDataClarificationResponse(userInput: string): string {
  const trimmedInput = userInput.trim()
  const structuredDataLabel = trimmedInput.startsWith('[') ? 'that structured list' : 'that structured data'
  return `I can help with ${structuredDataLabel}, but I need one thing first: do you want me to save it, explain it, or retrieve something related to it?`
}
