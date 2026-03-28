import { buildClarificationCandidateListMessage } from './commandDecompositionService'
import { getDocumentById } from './lanceService'
import {
  clearPendingCommandClarification,
  type PendingCommandClarificationState,
} from './commandClarificationState'
import type { LoreDocument } from '../../shared/types'

export async function producePendingClarificationReplay(
  pending: PendingCommandClarificationState,
): Promise<{
  readonly message: string
  readonly summary: string
  readonly retrievedIds: readonly string[]
} | null> {
  const orderedDocuments: LoreDocument[] = []
  for (const id of pending.candidateDocumentIds) {
    const document = await getDocumentById(id)
    if (document !== null) {
      orderedDocuments.push(document)
    }
  }
  if (orderedDocuments.length === 0) {
    clearPendingCommandClarification()
    return null
  }
  const action = pending.commandIntent === 'delete' ? 'delete' : 'update'
  const message = buildClarificationCandidateListMessage(action, orderedDocuments)
  return {
    message,
    summary: 'Command: replayed numbered clarification list for pending command.',
    retrievedIds: orderedDocuments.map((document) => document.id),
  }
}
