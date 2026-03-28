import { getDocumentById } from './lanceService'
import type { ConversationEntry, LoreDocument } from '../../shared/types'

export const PRIOR_TURN_RETRIEVED_CONTEXT_HEADER =
  'Prior turn: notes retrieved from the library in the last assistant turn (supplemental context only; the user’s current message is authoritative).'

const PREVIEW_CHARS_PER_DOCUMENT = 320
const MAX_CONTEXT_BLOCK_TOTAL_CHARS = 12_000

export function dedupeDocumentIdsPreservingOrder(ids: readonly string[]): string[] {
  const seen = new Set<string>()
  const ordered: string[] = []
  for (const id of ids) {
    if (id.trim().length === 0 || seen.has(id)) {
      continue
    }
    seen.add(id)
    ordered.push(id)
  }
  return ordered
}

function formatDocumentPreviewEntry(index: number, document: LoreDocument): string {
  const body = document.content.trim()
  const preview =
    body.length > PREVIEW_CHARS_PER_DOCUMENT
      ? `${body.slice(0, PREVIEW_CHARS_PER_DOCUMENT)}…`
      : body
  return [
    `${index + 1}. id=${document.id}`,
    `Type: ${document.type}`,
    `Date: ${document.date}`,
    `Preview:\n${preview.length > 0 ? preview : '(empty)'}`,
  ].join('\n')
}

/**
 * Loads current rows from the database and builds a single markdown block for LLM context.
 * Returns null when there is nothing to add (no ids or all missing).
 */
export async function buildPriorTurnRetrievedContextBlock(
  documentIds: readonly string[],
): Promise<string | null> {
  const uniqueIds = dedupeDocumentIdsPreservingOrder(documentIds)
  if (uniqueIds.length === 0) {
    return null
  }

  const entries: string[] = []
  let totalLength = 0

  for (let index = 0; index < uniqueIds.length; index += 1) {
    const id = uniqueIds[index]
    if (id === undefined) {
      continue
    }
    const document = await getDocumentById(id)
    if (document === null || document.isDeleted) {
      continue
    }
    const piece = formatDocumentPreviewEntry(entries.length, document)
    const separator = entries.length > 0 ? '\n\n' : ''
    const additionLength = separator.length + piece.length
    if (totalLength + additionLength > MAX_CONTEXT_BLOCK_TOTAL_CHARS) {
      break
    }
    entries.push(piece)
    totalLength += additionLength
  }

  if (entries.length === 0) {
    return null
  }

  return entries.join('\n\n')
}

export function augmentConversationHistoryWithPriorTurnContext(
  history: readonly ConversationEntry[],
  priorTurnRetrievedContextBlock: string | null,
): ConversationEntry[] {
  const trimmed = priorTurnRetrievedContextBlock?.trim() ?? ''
  if (trimmed.length === 0) {
    return [...history]
  }
  return [
    ...history,
    {
      role: 'user' as const,
      content: `${PRIOR_TURN_RETRIEVED_CONTEXT_HEADER}\n\n${trimmed}`,
    },
  ]
}
