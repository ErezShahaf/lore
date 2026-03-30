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
