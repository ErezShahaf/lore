import { v4 as uuidv4 } from 'uuid'
import { embedText } from './embeddingService'
import {
  insertDocument,
  searchSimilar,
  getAllDocuments,
} from './lanceService'
import type {
  LoreDocument,
  StoreThoughtInput,
  RetrievalOptions,
  ScoredDocument,
  RetrievedDocumentSet,
  TodoMetadata,
} from '../../shared/types'

const DEFAULT_MAX_RESULTS = 20
const DUPLICATE_THRESHOLD = 0.92
const RELEVANCE_CLIFF_RATIO = 0.3
const ADAPTIVE_FETCH_LIMIT = 30
const ADAPTIVE_MAX_RETURN = 10

export async function storeThought(input: StoreThoughtInput): Promise<LoreDocument> {
  const vector = await embedText(input.content)
  const now = new Date().toISOString()

  const document: LoreDocument = {
    id: uuidv4(),
    content: input.content,
    vector,
    type: input.type,
    createdAt: now,
    updatedAt: now,
    date: input.date,
    tags: input.tags.join(','),
    source: input.originalInput,
    metadata: '{}',
    isDeleted: false,
  }

  await insertDocument(document)
  return document
}

export async function storeThoughtWithMetadata(
  input: StoreThoughtInput,
  metadata: Record<string, unknown>,
): Promise<LoreDocument> {
  const vector = await embedText(input.content)
  const now = new Date().toISOString()

  const document: LoreDocument = {
    id: uuidv4(),
    content: input.content,
    vector,
    type: input.type,
    createdAt: now,
    updatedAt: now,
    date: input.date,
    tags: input.tags.join(','),
    source: input.originalInput,
    metadata: JSON.stringify(metadata),
    isDeleted: false,
  }

  await insertDocument(document)
  return document
}

// ── Duplicate detection ───────────────────────────────────────

export async function checkForDuplicate(content: string): Promise<LoreDocument | null> {
  const embedding = await embedText(content)
  const results = await searchSimilar(embedding, 1)

  if (results.length === 0) return null

  const top = results[0]
  const distance = '_distance' in top
    ? (top as Record<string, unknown>)._distance as number
    : 1
  const similarity = 1 - distance

  if (similarity >= DUPLICATE_THRESHOLD) {
    return rowToLoreDoc(top)
  }
  return null
}

function rowToLoreDoc(row: Record<string, unknown>): LoreDocument {
  return row as unknown as LoreDocument
}

// ── Standard retrieval ────────────────────────────────────────

export async function retrieveRelevantDocuments(
  query: string,
  options?: RetrievalOptions,
): Promise<LoreDocument[]> {
  const queryVector = await embedText(query)

  const limit = options?.maxResults ?? DEFAULT_MAX_RESULTS

  const filterParts: string[] = []
  if (options?.type) {
    filterParts.push(`type = '${options.type}'`)
  }
  if (options?.dateFrom) {
    filterParts.push(`date >= '${options.dateFrom}'`)
  }
  if (options?.dateTo) {
    filterParts.push(`date <= '${options.dateTo}'`)
  }

  const filter = filterParts.length > 0 ? filterParts.join(' AND ') : undefined

  return searchSimilar(queryVector, limit, filter)
}

// ── Adaptive retrieval ────────────────────────────────────────

export async function retrieveWithAdaptiveThreshold(
  query: string,
  options?: RetrievalOptions,
): Promise<RetrievedDocumentSet> {
  const queryVector = await embedText(query)

  const filterParts: string[] = []
  if (options?.type) {
    filterParts.push(`type = '${options.type}'`)
  }
  if (options?.dateFrom) {
    filterParts.push(`date >= '${options.dateFrom}'`)
  }
  if (options?.dateTo) {
    filterParts.push(`date <= '${options.dateTo}'`)
  }

  const filter = filterParts.length > 0 ? filterParts.join(' AND ') : undefined

  const rawResults = await searchSimilar(queryVector, ADAPTIVE_FETCH_LIMIT, filter)

  const scored: ScoredDocument[] = rawResults.map((doc) => {
    const distance = '_distance' in doc
      ? (doc as Record<string, unknown>)._distance as number
      : 0
    return { ...doc, score: 1 - distance }
  })

  const relevant = applyRelevanceCliff(scored)

  return {
    documents: relevant,
    totalCandidates: scored.length,
    cutoffScore: relevant.length > 0 ? relevant[relevant.length - 1].score : 0,
  }
}

function applyRelevanceCliff(results: ScoredDocument[]): ScoredDocument[] {
  if (results.length === 0) return []
  if (results.length === 1) return results

  const kept: ScoredDocument[] = [results[0]]

  for (let i = 1; i < results.length && kept.length < ADAPTIVE_MAX_RETURN; i++) {
    const gap = results[i - 1].score - results[i].score
    const relativeGap = results[i - 1].score > 0
      ? gap / results[i - 1].score
      : gap

    if (relativeGap > RELEVANCE_CLIFF_RATIO) break

    kept.push(results[i])
  }

  return kept
}

// ── Todo-specific retrieval ───────────────────────────────────

export async function retrieveActiveTodos(): Promise<LoreDocument[]> {
  const allTodos = await getAllDocuments(false)
  return allTodos.filter((doc) => {
    if (doc.type !== 'todo') return false
    try {
      const meta = JSON.parse(doc.metadata) as Partial<TodoMetadata>
      return !meta.completed
    } catch {
      return true
    }
  })
}

export async function getDocumentCount(): Promise<number> {
  const docs = await getAllDocuments(false)
  return docs.length
}
