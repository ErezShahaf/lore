import { classifyInput } from './classifierService'
import { handleThought } from './handlers/thoughtHandler'
import { handleQuestion } from './handlers/questionHandler'
import { handleCommand } from './handlers/commandHandler'
import { handleInstruction } from './handlers/instructionHandler'
import type { AgentEvent } from '../../shared/types'

interface ConversationEntry {
  role: 'user' | 'assistant'
  content: string
}

let conversationHistory: ConversationEntry[] = []

export function clearConversation(): void {
  conversationHistory = []
}

export function getConversationHistory(): ConversationEntry[] {
  return conversationHistory
}

export async function* processUserInput(userInput: string): AsyncGenerator<AgentEvent> {
  conversationHistory.push({ role: 'user', content: userInput })

  yield { type: 'status', message: 'Classifying your input...' }

  let classification
  try {
    classification = await classifyInput(userInput)
  } catch (err) {
    yield {
      type: 'error',
      message: 'Failed to classify input. Please try again.',
    }
    yield { type: 'done' }
    return
  }

  console.log(
    `[Agent] Classified as ${classification.intent}/${classification.subtype} (confidence: ${classification.confidence})`,
  )

  let assistantResponse = ''

  try {
    switch (classification.intent) {
      case 'thought': {
        for await (const event of handleThought(userInput, classification)) {
          if (event.type === 'chunk') assistantResponse += event.content
          yield event
        }
        break
      }
      case 'question': {
        const context = conversationHistory.slice(-6)
        for await (const event of handleQuestion(userInput, classification, context)) {
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
    conversationHistory.push({ role: 'assistant', content: assistantResponse })
  }

  const MAX_HISTORY = 20
  if (conversationHistory.length > MAX_HISTORY) {
    conversationHistory = conversationHistory.slice(-MAX_HISTORY)
  }
}
