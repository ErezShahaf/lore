import type { RetrievalOptions } from '../../shared/types'

export interface PendingCommandClarificationState {
  readonly candidateDocumentIds: readonly string[]
  readonly commandIntent: 'delete' | 'edit'
  readonly retrievalOptions: RetrievalOptions | undefined
}

let pendingCommandClarification: PendingCommandClarificationState | null = null

export function getPendingCommandClarification(): PendingCommandClarificationState | null {
  return pendingCommandClarification
}

export function setPendingCommandClarification(state: PendingCommandClarificationState | null): void {
  pendingCommandClarification = state
}

export function clearPendingCommandClarification(): void {
  pendingCommandClarification = null
}

export function parseClarificationNumericReply(trimmedInput: string): number | null {
  const digitsOnly = trimmedInput.match(/^\s*(\d+)\s*$/)
  if (digitsOnly) {
    return Number.parseInt(digitsOnly[1], 10)
  }
  const optionForm = trimmedInput.match(/^\s*option\s*#?\s*(\d+)\s*$/i)
  if (optionForm) {
    return Number.parseInt(optionForm[1], 10)
  }
  return null
}

export function isClarificationOptionsReplayRequest(userInput: string): boolean {
  const lower = userInput.trim().toLowerCase()
  return /\bwhat\s+are\s+(the\s+)?options\b/.test(lower)
    || /\b(list|show)\s+(the\s+)?options\b/.test(lower)
    || /\brepeat\s+(the\s+)?options\b/.test(lower)
}
