import { logger } from '../logger'
import { clearPendingCommandClarification } from './commandClarificationState'
import { clearPendingDuplicateSaveClarification } from './duplicateSaveClarificationState'
import {
  buildPriorTurnRetrievedContextBlock,
  dedupeDocumentIdsPreservingOrder,
} from './priorTurnContextService'
import { runMultiActionTurn } from './multiActionOrchestrator'
import {
  PIPELINE_TRACE_SCHEMA_VERSION,
  type AgentEvent,
  type ConversationEntry,
  type MutablePipelineTraceSink,
  type PipelineTracePayload,
} from '../../shared/types'

interface SessionContext {
  history: ConversationEntry[]
  lastDocumentIds: string[]
  /** Document ids from `retrieved` events in the last completed turn; used to hydrate prior-turn LLM context. */
  lastTurnRetrievedDocumentIds: string[]
  lastPipelineTrace: PipelineTracePayload | null
}

let session: SessionContext = {
  history: [],
  lastDocumentIds: [],
  lastTurnRetrievedDocumentIds: [],
  lastPipelineTrace: null,
}

export function clearConversation(): void {
  clearPendingCommandClarification()
  clearPendingDuplicateSaveClarification()
  session = {
    history: [],
    lastDocumentIds: [],
    lastTurnRetrievedDocumentIds: [],
    lastPipelineTrace: null,
  }
}

export function getConversationHistory(): ConversationEntry[] {
  return session.history
}

export function getLastPipelineTrace(): PipelineTracePayload | null {
  return session.lastPipelineTrace
}

export async function* processUserInput(userInput: string): AsyncGenerator<AgentEvent> {
  const priorHistory = session.history.slice()
  session.history.push({ role: 'user', content: userInput })

  const priorTurnRetrievedContextBlock = await buildPriorTurnRetrievedContextBlock(
    session.lastTurnRetrievedDocumentIds,
  )

  const traceSink: MutablePipelineTraceSink = {
    traceSchemaVersion: PIPELINE_TRACE_SCHEMA_VERSION,
    stages: [],
  }
  session.lastPipelineTrace = null

  let assistantResponse = ''
  const documentIds: string[] = []
  const retrievedDocumentIdsThisTurn: string[] = []

  try {
    for await (const event of runMultiActionTurn(
      userInput,
      priorHistory,
      traceSink,
      priorTurnRetrievedContextBlock,
    )) {
      if (event.type === 'chunk') {
        assistantResponse += event.content
      }
      if (event.type === 'retrieved') {
        documentIds.push(...event.documentIds)
        retrievedDocumentIdsThisTurn.push(...event.documentIds)
      }
      if (event.type === 'stored') {
        documentIds.push(event.documentId)
      }
      yield event
    }
  } catch (err) {
    logger.error({ err }, '[Agent] Orchestrator failed')
    session.lastPipelineTrace = {
      traceSchemaVersion: PIPELINE_TRACE_SCHEMA_VERSION,
      stages: traceSink.stages.slice(),
    }
    yield {
      type: 'error',
      message: err instanceof Error ? err.message : 'An unexpected error occurred',
    }
    yield { type: 'done' }
    return
  }

  session.lastPipelineTrace = {
    traceSchemaVersion: traceSink.traceSchemaVersion,
    stages: traceSink.stages.slice(),
  }

  if (assistantResponse) {
    session.history.push({ role: 'assistant', content: assistantResponse })
  }

  session.lastDocumentIds = documentIds
  session.lastTurnRetrievedDocumentIds = dedupeDocumentIdsPreservingOrder(retrievedDocumentIdsThisTurn)
}
