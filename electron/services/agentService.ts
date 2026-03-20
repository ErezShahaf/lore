import { classifyInput } from './classifierService'
import { logger } from '../logger'
import { handleThought } from './handlers/thoughtHandler'
import { handleQuestion } from './handlers/questionHandler'
import { handleCommand } from './handlers/commandHandler'
import { handleInstruction } from './handlers/instructionHandler'
import { handleConversational } from './handlers/conversationalHandler'
import type {
  AgentEvent,
  ConversationEntry,
  InputClassification,
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
          const isTodoQuery = classification.extractedTags.some((tag) => tag === 'todo')
          const todoOverrides = isTodoQuery ? ({ type: 'todo' } as const) : undefined
          for await (const event of handleQuestion(userInput, classification, priorHistory, todoOverrides)) {
            if (event.type === 'chunk') assistantResponse += event.content
            if (event.type === 'retrieved') session.lastDocumentIds = [...event.documentIds]
            yield event
          }
          break
        }
        case 'command': {
          for await (const event of handleCommand(userInput, classification, priorHistory)) {
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
