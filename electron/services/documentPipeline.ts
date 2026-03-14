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

const DEFAULT_MAX_RESULTS = 1000
const DUPLICATE_THRESHOLD = 0.92
const RELEVANCE_CLIFF_RATIO = 0.3
const MINIMUM_RELEVANCE_SCORE = 0.4

const TAG_BOOST_FACTOR = 0.15

function buildFilter(options?: RetrievalOptions): string | undefined {
  const parts: string[] = []
  if (options?.type) {
    parts.push(`type = '${options.type}'`)
  }
  if (options?.dateFrom) {
    parts.push(`date >= '${options.dateFrom}'`)
  }
  if (options?.dateTo) {
    parts.push(`date <= '${options.dateTo}'`)
  }
  return parts.length > 0 ? parts.join(' AND ') : undefined
}

function boostByTags(docs: ScoredDocument[], queryTags: string[]): ScoredDocument[] {
  if (queryTags.length === 0) return docs

  const lowerTags = queryTags.map((t) => t.toLowerCase())

  return docs.map((doc) => {
    const docTags = (doc.tags || '').toLowerCase().split(',').filter(Boolean)
    const matchCount = lowerTags.filter((qt) =>
      docTags.some((dt) => dt.includes(qt) || qt.includes(dt)),
    ).length
    if (matchCount === 0) return doc
    const boost = TAG_BOOST_FACTOR * (matchCount / lowerTags.length)
    return { ...doc, score: doc.score + boost }
  })
}

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
  console.log(`[store] saved ${document.type} (id=${document.id.slice(0, 8)}) tags=[${input.tags}] content="${input.content.slice(0, 80)}"`)
  return document
}

export async function storeThoughtWithMetadata(
  input: StoreThoughtInput,
  metadata: object,
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
  console.log(`[store] saved ${document.type} (id=${document.id.slice(0, 8)}) tags=[${input.tags}] content="${input.content.slice(0, 80)}"`)
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
    return rowToLoreDoc(top as unknown as Record<string, unknown>)
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
  const filter = buildFilter(options)

  return searchSimilar(queryVector, limit, filter)
}

// ── Adaptive retrieval ────────────────────────────────────────

export async function retrieveWithAdaptiveThreshold(
  query: string,
  options?: RetrievalOptions,
): Promise<RetrievedDocumentSet> {
  const queryVector = await embedText(query)
  const filter = buildFilter(options)

  const rawResults = await searchSimilar(queryVector, 1000, filter)

  const scored: ScoredDocument[] = rawResults.map((doc) => {
    const distance = '_distance' in doc
      ? (doc as Record<string, unknown>)._distance as number
      : 0
    return { ...doc, score: 1 - distance }
  })

  const boosted = boostByTags(scored, options?.tags ?? [])
    .sort((a, b) => b.score - a.score)

  if (boosted.length > 0) {
    console.log(
      `[retrieval] top scores: ${boosted.map((d) => `${d.score.toFixed(3)}${d.tags ? ` [${d.tags}]` : ''}`).join(', ')}`,
    )
  }

  const relevant = applyRelevanceCliff(boosted)

  console.log(
    `[retrieval] ${boosted.length} candidates → ${relevant.length} after cliff+floor (min=${MINIMUM_RELEVANCE_SCORE})`,
  )

  return {
    documents: relevant,
    totalCandidates: boosted.length,
    cutoffScore: relevant.length > 0 ? relevant[relevant.length - 1].score : 0,
  }
}

function applyRelevanceCliff(results: ScoredDocument[]): ScoredDocument[] {
  if (results.length === 0) return []

  if (results[0].score < MINIMUM_RELEVANCE_SCORE) return []

  const kept: ScoredDocument[] = [results[0]]

  for (let i = 1; i < results.length; i++) {
    if (results[i].score < MINIMUM_RELEVANCE_SCORE) break

    const gap = results[i - 1].score - results[i].score
    const relativeGap = results[i - 1].score > 0
      ? gap / results[i - 1].score
      : gap

    if (relativeGap > RELEVANCE_CLIFF_RATIO) break

    kept.push(results[i])
  }

  return kept
}

// ── Multi-query retrieval ─────────────────────────────────────

export async function multiQueryRetrieve(
  queries: string[],
  options?: RetrievalOptions,
): Promise<RetrievedDocumentSet> {
  const filter = buildFilter(options)

  const queryVectors = await Promise.all(queries.map((q) => embedText(q)))

  const allResults = await Promise.all(
    queryVectors.map((vec) => searchSimilar(vec, 1000, filter)),
  )

  const bestById = new Map<string, ScoredDocument>()

  for (const results of allResults) {
    for (const doc of results) {
      const distance = '_distance' in doc
        ? (doc as Record<string, unknown>)._distance as number
        : 0
      const score = 1 - distance
      const existing = bestById.get(doc.id)

      if (!existing || score > existing.score) {
        bestById.set(doc.id, { ...doc, score })
      }
    }
  }

  const scored = [...bestById.values()].sort((a, b) => b.score - a.score)

  if (scored.length > 0) {
    console.log(
      `[multi-query] ${queries.length} queries → ${scored.length} unique docs, ` +
      `scores: ${scored.map((d) => d.score.toFixed(3)).join(', ')}`,
    )
  }

  const relevant = applyRelevanceCliff(scored)

  console.log(
    `[multi-query] ${scored.length} candidates → ${relevant.length} after cliff+floor (min=${MINIMUM_RELEVANCE_SCORE})`,
  )

  return {
    documents: relevant,
    totalCandidates: scored.length,
    cutoffScore: relevant.length > 0 ? relevant[relevant.length - 1].score : 0,
  }
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
