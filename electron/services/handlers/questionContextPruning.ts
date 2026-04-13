import type { ScoredDocument } from '../../../shared/types'

const MAX_PROMPT_DOCUMENTS = 24
const MIN_RELEVANCE_FLOOR = 0.35
const MIN_RELEVANCE_RATIO = 0.6

interface ObsidianDocMetadata {
  fileName?: string
}

interface PruneOptions {
  titleFocused: boolean
}

function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/\.md$/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function parseObsidianDocMetadata(document: ScoredDocument): ObsidianDocMetadata | null {
  if (document.source !== 'obsidian') return null
  try {
    const parsed = JSON.parse(document.metadata) as ObsidianDocMetadata
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

export function pruneRetrievedDocumentsForAnswer(
  documents: readonly ScoredDocument[],
  options: PruneOptions,
): ScoredDocument[] {
  if (documents.length === 0) return []

  const sorted = [...documents].sort((left, right) => right.score - left.score)
  let candidateDocs = sorted

  // For explicit title retrieval, lock context to the top-matched Obsidian file.
  if (options.titleFocused) {
    const topObsidian = sorted.find((doc) => doc.source === 'obsidian')
    const topMeta = topObsidian ? parseObsidianDocMetadata(topObsidian) : null
    const topFileName = topMeta?.fileName ? normalizeTitle(topMeta.fileName) : ''

    if (topFileName) {
      const sameFileDocs = sorted.filter((doc) => {
        const meta = parseObsidianDocMetadata(doc)
        if (!meta?.fileName) return false
        return normalizeTitle(meta.fileName) === topFileName
      })

      if (sameFileDocs.length > 0) {
        candidateDocs = sameFileDocs
      }
    }
  }

  const topScore = candidateDocs[0]?.score ?? 0
  const minScore = Math.max(MIN_RELEVANCE_FLOOR, topScore * MIN_RELEVANCE_RATIO)
  const pruned = candidateDocs.filter((doc) => doc.score >= minScore)

  if (pruned.length > 0) {
    return pruned.slice(0, MAX_PROMPT_DOCUMENTS)
  }

  return candidateDocs.slice(0, MAX_PROMPT_DOCUMENTS)
}
