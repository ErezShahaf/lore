import { logger } from '../logger'
import { clearPendingCommandClarification } from './commandClarificationState'
import { clearPendingDuplicateSaveClarification } from './duplicateSaveClarificationState'
import { clearAllQuestionClarificationState } from './questionClarificationState'
import {
  buildPriorTurnRetrievedContextBlock,
  dedupeDocumentIdsPreservingOrder,
} from './priorTurnContextService'
import { runMultiActionTurn } from './multiActionOrchestrator'
import { compactSessionHistoryIfNeeded } from './sessionCompaction'
import { runNativeToolLoopTurn } from './turnEngine'
import { formatUserInstructionsBlock, loadAllUserInstructionDocuments } from './userInstructionsContext'
import { getSettings } from './settingsService'
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

let sessionResetEpoch = 0

export function clearConversation(): void {
  clearPendingCommandClarification()
  clearPendingDuplicateSaveClarification()
  clearAllQuestionClarificationState()
  sessionResetEpoch += 1
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
  const epochAtTurnStart = sessionResetEpoch
  const isSessionStillOwnedByThisTurn = (): boolean => epochAtTurnStart === sessionResetEpoch
  const isCancelled = (): boolean => !isSessionStillOwnedByThisTurn()

  session.history.push({ role: 'user', content: userInput })
  const userMessage = session.history[session.history.length - 1]!

  const traceSink: MutablePipelineTraceSink = {
    traceSchemaVersion: PIPELINE_TRACE_SCHEMA_VERSION,
    stages: [],
  }
  session.lastPipelineTrace = null

  const rawPriorHistory = session.history.slice(0, -1)
  const { entries: compactedPriorHistory } = compactSessionHistoryIfNeeded(rawPriorHistory, traceSink)
  session.history = [...compactedPriorHistory, userMessage]
  const priorHistory = compactedPriorHistory

  const priorTurnRetrievedContextBlock = await buildPriorTurnRetrievedContextBlock(
    session.lastTurnRetrievedDocumentIds,
  )

  let assistantResponse = ''
  const documentIds: string[] = []
  const retrievedDocumentIdsThisTurn: string[] = []

  const settings = getSettings()
  const useNativeToolLoop = settings.agentOrchestrationMode === 'native_tool_loop'

  try {
    if (useNativeToolLoop) {
      const userInstructionDocuments = await loadAllUserInstructionDocuments()
      const userInstructionsBlock = formatUserInstructionsBlock(userInstructionDocuments)

      for await (const event of runNativeToolLoopTurn(userInput, priorHistory, {
        traceSink,
        userInstructionsBlock,
        isCancelled,
        priorTurnRetrievedContextBlock,
      })) {
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
    } else {
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
    }
  } catch (err) {
    logger.error({ err }, '[Agent] Orchestrator failed')
    if (isSessionStillOwnedByThisTurn()) {
      session.lastPipelineTrace = {
        traceSchemaVersion: PIPELINE_TRACE_SCHEMA_VERSION,
        stages: traceSink.stages.slice(),
      }
    }
    yield {
      type: 'error',
      message: err instanceof Error ? err.message : 'An unexpected error occurred',
    }
    yield { type: 'done' }
    return
  }

  if (!isSessionStillOwnedByThisTurn()) {
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
