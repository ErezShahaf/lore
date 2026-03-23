import { logger } from '../logger'
import { runToolOrchestratedTurn } from './toolOrchestrator'
import type { AgentEvent, ConversationEntry } from '../../shared/types'

interface SessionContext {
  history: ConversationEntry[]
  lastDocumentIds: string[]
}

let session: SessionContext = {
  history: [],
  lastDocumentIds: [],
}

export function clearConversation(): void {
  session = {
    history: [],
    lastDocumentIds: [],
  }
}

export function getConversationHistory(): ConversationEntry[] {
  return session.history
}

export async function* processUserInput(userInput: string): AsyncGenerator<AgentEvent> {
  const priorHistory = session.history.slice()
  session.history.push({ role: 'user', content: userInput })

  let assistantResponse = ''
  const documentIds: string[] = []

  try {
    for await (const event of runToolOrchestratedTurn(userInput, priorHistory)) {
      if (event.type === 'chunk') {
        assistantResponse += event.content
      }
      if (event.type === 'retrieved') {
        documentIds.push(...event.documentIds)
      }
      if (event.type === 'stored') {
        documentIds.push(event.documentId)
      }
      yield event
    }
  } catch (err) {
    logger.error({ err }, '[Agent] Orchestrator failed')
    yield {
      type: 'error',
      message: err instanceof Error ? err.message : 'An unexpected error occurred',
    }
    yield { type: 'done' }
    return
  }

  if (assistantResponse) {
    session.history.push({ role: 'assistant', content: assistantResponse })
  }

  session.lastDocumentIds = documentIds
}
