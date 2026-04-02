import { logger } from '../logger'
import type { ConversationEntry, MutablePipelineTraceSink, PipelineSessionCompactionTraceOutput } from '../../shared/types'

const MAX_CONVERSATION_USER_TURNS = 24
const MAX_CONVERSATION_TOTAL_CHARS = 48_000

function countUserTurns(entries: readonly ConversationEntry[]): number {
  return entries.filter((entry) => entry.role === 'user').length
}

function totalChars(entries: readonly ConversationEntry[]): number {
  return entries.reduce((accumulator, entry) => accumulator + entry.content.length, 0)
}

export interface SessionCompactionResult {
  readonly entries: ConversationEntry[]
  readonly trace: PipelineSessionCompactionTraceOutput
}

/**
 * Emergency trim for long tray sessions: keep the most recent messages under caps.
 */
export function compactSessionHistoryIfNeeded(
  historyBeforeNewUserMessage: readonly ConversationEntry[],
  traceSink: MutablePipelineTraceSink | null,
): SessionCompactionResult {
  let entries = [...historyBeforeNewUserMessage]
  const initialUserTurns = countUserTurns(entries)
  const initialChars = totalChars(entries)

  let stopReason: PipelineSessionCompactionTraceOutput['stopReason'] = 'none'

  if (initialUserTurns <= MAX_CONVERSATION_USER_TURNS && initialChars <= MAX_CONVERSATION_TOTAL_CHARS) {
    const trace: PipelineSessionCompactionTraceOutput = {
      droppedTurnCount: 0,
      keptTurnCount: entries.length,
      stopReason: 'none',
    }
    return { entries, trace }
  }

  const targetUserBudget = Math.min(MAX_CONVERSATION_USER_TURNS, Math.max(8, Math.floor(initialUserTurns / 2)))

  while (countUserTurns(entries) > targetUserBudget && entries.length > 2) {
    entries = entries.slice(2)
    stopReason = 'message_cap'
  }

  while (totalChars(entries) > MAX_CONVERSATION_TOTAL_CHARS && entries.length > 2) {
    entries = entries.slice(2)
    stopReason = 'char_cap'
  }

  const droppedPairs = Math.max(0, Math.floor((historyBeforeNewUserMessage.length - entries.length) / 2))
  if (droppedPairs > 0) {
    logger.info(
      {
        droppedPairs,
        keptMessages: entries.length,
        stopReason,
      },
      '[SessionCompaction] Trimmed conversation history',
    )
  }

  const trace: PipelineSessionCompactionTraceOutput = {
    droppedTurnCount: droppedPairs,
    keptTurnCount: entries.length,
    stopReason,
  }

  if (traceSink && trace.stopReason !== 'none') {
    traceSink.stages.push({
      stageId: 'session_compaction',
      ordinal: traceSink.stages.length,
      timestamp: new Date().toISOString(),
      output: trace,
    })
  }

  return { entries, trace }
}
