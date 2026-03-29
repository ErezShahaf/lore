import type { DocumentType } from '../../shared/types'

export interface PendingDuplicateSaveClarificationState {
  readonly contentToStore: string
  readonly originalInputForSource: string
  readonly documentType: DocumentType
  readonly date: string
  readonly tags: readonly string[]
  /** Similar library rows (embedding + todo measure rules); replace uses the first id. */
  readonly duplicateDocumentIds: readonly string[]
}

let pendingDuplicateSaveClarification: PendingDuplicateSaveClarificationState | null = null

export function getPendingDuplicateSaveClarification(): PendingDuplicateSaveClarificationState | null {
  return pendingDuplicateSaveClarification
}

export function setPendingDuplicateSaveClarification(
  state: PendingDuplicateSaveClarificationState | null,
): void {
  pendingDuplicateSaveClarification = state
}

export function clearPendingDuplicateSaveClarification(): void {
  pendingDuplicateSaveClarification = null
}
