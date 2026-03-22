import { v4 as uuidv4 } from 'uuid'
import { logger } from '../logger'
import { embedText } from './embeddingService'
import {
  insertDocument,
  searchSimilar,
  getAllDocuments,
  getDocumentsByFilter,
} from './lanceService'
import type {
  LoreDocument,
  StoreThoughtInput,
  RetrievalOptions,
  ScoredDocument,
  RetrievedDocumentSet,
} from '../../shared/types'

const DEFAULT_MAX_RESULTS = 1000
const DUPLICATE_THRESHOLD = 0.92
const RELEVANCE_CLIFF_RATIO = 0.3
const MINIMUM_RELEVANCE_SCORE = 0.26

const TAG_BOOST_FACTOR = 0.32

function buildFilter(options?: RetrievalOptions): string | undefined {
  const parts: string[] = []
  if (options?.ids && options.ids.length > 0) {
    const idConditions = options.ids.map((id) => `id = '${escapeFilterValue(id)}'`)
    parts.push(`(${idConditions.join(' OR ')})`)
  }
  if (options?.type) {
    parts.push(`type = '${escapeFilterValue(options.type)}'`)
  }
  if (options?.dateFrom) {
    parts.push(`date >= '${escapeFilterValue(options.dateFrom)}'`)
  }
  if (options?.dateTo) {
    parts.push(`date <= '${escapeFilterValue(options.dateTo)}'`)
  }
  if (options?.createdAtFrom) {
    parts.push(`createdAt >= '${escapeFilterValue(options.createdAtFrom)}'`)
  }
  if (options?.createdAtTo) {
    parts.push(`createdAt < '${escapeFilterValue(options.createdAtTo)}'`)
  }
  return parts.length > 0 ? parts.join(' AND ') : undefined
}

const DEFAULT_TODO_COMMAND_CANDIDATE_LIMIT = 200

export async function retrieveTodoCandidatesForCommand(
  options?: RetrievalOptions,
): Promise<LoreDocument[]> {
  const filter = buildFilter({ ...options, type: 'todo' })
  const limit = options?.maxResults ?? DEFAULT_TODO_COMMAND_CANDIDATE_LIMIT
  const documents = await getDocumentsByFilter(filter, limit)
  return [...documents].sort((left, right) => right.createdAt.localeCompare(left.createdAt))
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
  logger.debug({ type: document.type, id: document.id.slice(0, 8), tags: input.tags, contentPreview: input.content.slice(0, 80) }, '[store] saved document')
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
  logger.debug({ type: document.type, id: document.id.slice(0, 8), tags: input.tags, contentPreview: input.content.slice(0, 80) }, '[store] saved document')
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
  const rawResults = await searchSimilar(queryVector, limit, filter)

  if (typeof options?.similarityThreshold !== 'number') {
    return rawResults
  }

  return rawResults.filter((document) => {
    const distance = '_distance' in document
      ? (document as Record<string, unknown>)._distance as number
      : 1
    return 1 - distance >= options.similarityThreshold!
  })
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
    logger.debug(
      { scores: boosted.map((d) => `${d.score.toFixed(3)}${d.tags ? ` [${d.tags}]` : ''}`) },
      '[retrieval] adaptive threshold: top scores (before relevance cliff)',
    )
  }

  const relevant = applyRelevanceCliff(boosted)

  logger.debug(
    {
      preCliffCandidateCount: boosted.length,
      finalDocumentCount: relevant.length,
      minimumScoreFloor: MINIMUM_RELEVANCE_SCORE,
      note: 'Top scores above are pre-cliff; finalDocumentCount is what the question handler uses.',
    },
    '[retrieval] adaptive threshold: after relevance cliff',
  )

  return {
    documents: relevant,
    totalCandidates: boosted.length,
    cutoffScore: relevant.length > 0 ? relevant[relevant.length - 1].score : 0,
  }
}

export async function retrieveByFilters(
  options?: RetrievalOptions,
): Promise<RetrievedDocumentSet> {
  const filter = buildFilter(options)
  const limit = options?.maxResults ?? DEFAULT_MAX_RESULTS
  const documents = await getDocumentsByFilter(filter, limit)

  const scoredDocuments: ScoredDocument[] = boostByTags(
    documents.map((document) => ({ ...document, score: 1 })),
    options?.tags ?? [],
  ).sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score
    }

    return right.createdAt.localeCompare(left.createdAt)
  })

  return {
    documents: scoredDocuments,
    totalCandidates: scoredDocuments.length,
    cutoffScore: scoredDocuments.length > 0 ? scoredDocuments[scoredDocuments.length - 1].score : 0,
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

  const merged = [...bestById.values()]
  const scored = boostByTags(merged, options?.tags ?? []).sort((left, right) => right.score - left.score)

  if (scored.length > 0) {
    logger.debug(
      { queryCount: queries.length, uniqueDocs: scored.length, scores: scored.map((d) => d.score.toFixed(3)) },
      '[multi-query] unique docs',
    )
  }

  const relevant = applyRelevanceCliff(scored)

  logger.debug(
    {
      preCliffCandidateCount: scored.length,
      finalDocumentCount: relevant.length,
      minimumScoreFloor: MINIMUM_RELEVANCE_SCORE,
      note: 'Unique docs are pre-cliff; finalDocumentCount is what the question handler uses.',
    },
    '[multi-query] after relevance cliff',
  )

  return {
    documents: relevant,
    totalCandidates: scored.length,
    cutoffScore: relevant.length > 0 ? relevant[relevant.length - 1].score : 0,
  }
}

export async function getDocumentCount(): Promise<number> {
  const docs = await getAllDocuments(false)
  return docs.length
}

function escapeFilterValue(value: string): string {
  return value.replace(/'/g, "''")
}
