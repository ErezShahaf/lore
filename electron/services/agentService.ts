import { classifyInput } from './classifierService'
import { handleThought } from './handlers/thoughtHandler'
import { handleQuestion } from './handlers/questionHandler'
import { handleCommand } from './handlers/commandHandler'
import { handleInstruction } from './handlers/instructionHandler'
import type { AgentEvent, RetrievalOptions } from '../../shared/types'

// ── Session context ──────────────────────────────────────────

interface ConversationEntry {
  role: 'user' | 'assistant'
  content: string
}

interface SessionContext {
  history: ConversationEntry[]
  lastDocumentIds: string[]
  lastTopic: string | null
}

const MAX_HISTORY = 20
const SESSION_WINDOW = 10

let session: SessionContext = {
  history: [],
  lastDocumentIds: [],
  lastTopic: null,
}

export function clearConversation(): void {
  session = {
    history: [],
    lastDocumentIds: [],
    lastTopic: null,
  }
}

export function getConversationHistory(): ConversationEntry[] {
  return session.history
}

// ── Confidence thresholds ─────────────────────────────────────

const CLASSIFICATION_CONFIDENCE_THRESHOLD = 0.6

// ── Main processing loop ─────────────────────────────────────

export async function* processUserInput(userInput: string): AsyncGenerator<AgentEvent> {
  session.history.push({ role: 'user', content: userInput })

  yield { type: 'status', message: 'Classifying your input...' }

  let classification
  try {
    classification = await classifyInput(userInput)
  } catch (err) {
    console.error('[Agent] Classification failed:', err)
    yield {
      type: 'chunk',
      content: "Sorry, I had trouble understanding that. Could you try rephrasing?",
    }
    yield { type: 'done' }
    return
  }

  console.log(
    `[Agent] Classified as ${classification.intent}/${classification.subtype} (confidence: ${classification.confidence})`,
  )

  if (classification.confidence < CLASSIFICATION_CONFIDENCE_THRESHOLD) {
    console.warn(
      `[Agent] Classification confidence too low (${classification.confidence}), refusing to act`,
    )
    yield {
      type: 'chunk',
      content: "I'm not sure what you'd like me to do. Could you provide more detail or rephrase?",
    }
    yield { type: 'done' }
    session.history.push({
      role: 'assistant',
      content: "I'm not sure what you'd like me to do. Could you provide more detail or rephrase?",
    })
    return
  }

  let assistantResponse = ''

  try {
    switch (classification.intent) {
        case 'thought': {
          for await (const event of handleThought(userInput, classification)) {
            if (event.type === 'chunk') assistantResponse += event.content
            if (event.type === 'stored') session.lastDocumentIds = [event.documentId]
            yield event
          }
          break
        }
        case 'question': {
          const context = session.history.slice(-SESSION_WINDOW)
          const todoOverrides: RetrievalOptions | undefined = isTodoListQuery(userInput)
            ? { type: 'todo' }
            : undefined
          for await (const event of handleQuestion(userInput, classification, context, todoOverrides)) {
            if (event.type === 'chunk') assistantResponse += event.content
            yield event
          }
          break
        }
        case 'command': {
          for await (const event of handleCommand(userInput, classification)) {
            if (event.type === 'chunk') assistantResponse += event.content
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
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'An unexpected error occurred'
    yield { type: 'error', message }
    yield { type: 'done' }
    return
  }

  if (assistantResponse) {
    session.history.push({ role: 'assistant', content: assistantResponse })
  }

  if (classification.extractedTags.length > 0) {
    session.lastTopic = classification.extractedTags[0]
  }

  if (session.history.length > MAX_HISTORY) {
    session.history = session.history.slice(-MAX_HISTORY)
  }
}

function isTodoListQuery(input: string): boolean {
  const lower = input.toLowerCase()
  return /\b(todo|to-do|to do)\s*(list|items?|tasks?)?\b/.test(lower) &&
    /\b(show|list|what|get|display|see|view)\b/.test(lower)
}
