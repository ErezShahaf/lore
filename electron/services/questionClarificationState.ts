import { parseClarificationNumericReply } from './commandClarificationState'
import type { ClassificationAction } from '../../shared/types'

export interface PendingQuestionClarificationState {
  readonly priorUserInput: string
  readonly candidateDocumentIds: readonly string[]
  readonly classificationSnapshot: Pick<
    ClassificationAction,
    'extractedTags' | 'extractedDate' | 'situationSummary' | 'data'
  >
}

export interface ConsumedQuestionFollowUpPayload {
  readonly priorUserInput: string
  readonly followUpInput: string
  readonly mergedUserInput: string
  readonly candidateDocumentIds: readonly string[]
  readonly classificationSnapshot: PendingQuestionClarificationState['classificationSnapshot']
}

let pendingQuestionClarification: PendingQuestionClarificationState | null = null
let consumedQuestionFollowUp: ConsumedQuestionFollowUpPayload | null = null

export function setPendingQuestionClarification(
  state: PendingQuestionClarificationState | null,
): void {
  pendingQuestionClarification = state
}

export function getPendingQuestionClarification(): PendingQuestionClarificationState | null {
  return pendingQuestionClarification
}

export function clearPendingQuestionClarification(): void {
  pendingQuestionClarification = null
}

export function clearAllQuestionClarificationState(): void {
  pendingQuestionClarification = null
  consumedQuestionFollowUp = null
}

export function setConsumedQuestionFollowUp(
  payload: ConsumedQuestionFollowUpPayload | null,
): void {
  consumedQuestionFollowUp = payload
}

export function takeConsumedQuestionFollowUp(): ConsumedQuestionFollowUpPayload | null {
  const value = consumedQuestionFollowUp
  consumedQuestionFollowUp = null
  return value
}

/**
 * True when the user is likely answering a prior “which one?” question rather than starting a new task.
 */
export function looksLikeQuestionClarificationNarrowingReply(userInput: string): boolean {
  const trimmed = userInput.trim()
  if (trimmed.length === 0 || trimmed.length > 220) {
    return false
  }
  if (parseClarificationNumericReply(trimmed) !== null) {
    return true
  }
  if (/^option\s*#?\s*\d+\s*$/i.test(trimmed)) {
    return true
  }
  if (/\bi mean\b/i.test(trimmed)) {
    return true
  }
  if (/\b(the first|the second|first one|second one|that one|this one)\b/i.test(trimmed)) {
    return true
  }
  if (
    trimmed.length < 120
    && /\b(from finance|from design|finance one|design one|the finance|the design)\b/i.test(trimmed)
  ) {
    return true
  }
  return false
}
