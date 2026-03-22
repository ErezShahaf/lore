import { logger } from '../logger'
import {
  createEmptyOrchestratorTurn,
  ORCHESTRATOR_CLASSIFICATION_CONFIDENCE_THRESHOLD,
  runOrchestratedTurn,
} from './orchestratorService'
import type { AgentEvent, ConversationEntry, InputClassification } from '../../shared/types'

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

export async function* processUserInput(userInput: string): AsyncGenerator<AgentEvent> {
  const priorHistory = session.history.slice()
  session.history.push({ role: 'user', content: userInput })

  const turn = createEmptyOrchestratorTurn()

  try {
    for await (const event of runOrchestratedTurn(userInput, priorHistory, turn)) {
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

  if (turn.assistantResponse) {
    session.history.push({ role: 'assistant', content: turn.assistantResponse })
  }

  session.lastDocumentIds = turn.lastDocumentIds

  if (
    turn.classification
    && turn.classification.confidence >= ORCHESTRATOR_CLASSIFICATION_CONFIDENCE_THRESHOLD
  ) {
    if (turn.classification.extractedTags.length > 0) {
      session.lastTopic = turn.classification.extractedTags[0]
    }
    session.lastIntent = turn.classification.intent
  }
}
