import { v4 as uuidv4 } from 'uuid'
import { logger } from '../logger'
import { canonicalizeJsonFromNoteText } from './jsonBlobUtils'
import { embedText } from './embeddingService'
import {
  insertDocument,
  searchSimilar,
  getAllDocuments,
  getDocumentsByFilter,
} from './lanceService'
import type {
  DocumentType,
  LoreDocument,
  StoreThoughtInput,
  RetrievalOptions,
  ScoredDocument,
  RetrievedDocumentSet,
} from '../../shared/types'

const DEFAULT_MAX_RESULTS = 1000
const DUPLICATE_THRESHOLD = 0.92
const DUPLICATE_THRESHOLD_TODO = 0.97
const RELEVANCE_CLIFF_RATIO = 0.3
const MINIMUM_RELEVANCE_SCORE = 0.24

const TAG_BOOST_FACTOR = 0.32
const LEXICAL_OVERLAP_BOOST_MAX = 0.14

function extractRetrievalLexicalTokens(text: string): readonly string[] {
  const normalized = text.toLowerCase()
  const raw = normalized.match(/\b[\w.]+\b/g) ?? []
  const filtered = raw.filter((token) => token.length >= 3)
  return [...new Set(filtered)]
}

export function lexicalMatchRatio(referenceText: string, documentContent: string): number {
  const tokens = extractRetrievalLexicalTokens(referenceText)
  if (tokens.length === 0) return 0
  const lowerContent = documentContent.toLowerCase()
  const hitCount = tokens.filter((token) => lowerContent.includes(token)).length
  return hitCount / tokens.length
}

function boostByLexicalOverlap(docs: ScoredDocument[], referenceText: string): ScoredDocument[] {
  if (referenceText.trim().length === 0) return docs
  return docs.map((document) => {
    const ratio = lexicalMatchRatio(referenceText, document.content)
    return { ...document, score: document.score + ratio * LEXICAL_OVERLAP_BOOST_MAX }
  })
}

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

const DUPLICATE_VECTOR_SEARCH_LIMIT = 8

export interface CheckDuplicateOptions {
  readonly documentType?: DocumentType
}

const TODO_MEASURE_PATTERN = /(\d+(?:\.\d+)?)\s*(km|kilometers?|mi|miles?|mins?|minutes?|hrs?|hours?)\b/gi

function canonicalMeasureUnit(rawUnit: string): string | null {
  const lower = rawUnit.toLowerCase()
  if (lower === 'km' || lower.startsWith('kilometer')) return 'km'
  if (lower === 'mi' || lower.startsWith('mile')) return 'mi'
  if (lower === 'min' || lower === 'mins' || lower.startsWith('minute')) return 'min'
  if (lower === 'hr' || lower === 'hrs' || lower.startsWith('hour')) return 'hr'
  return null
}

export function extractTodoMeasureMap(text: string): ReadonlyMap<string, number> {
  const map = new Map<string, number>()
  const pattern = new RegExp(TODO_MEASURE_PATTERN.source, TODO_MEASURE_PATTERN.flags)
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    const value = Number.parseFloat(match[1])
    if (Number.isNaN(value)) continue
    const unitKey = canonicalMeasureUnit(match[2])
    if (unitKey === null) continue
    map.set(unitKey, value)
  }
  return map
}

function todoMeasuresConflict(incomingContent: string, existingContent: string): boolean {
  const incomingMeasures = extractTodoMeasureMap(incomingContent)
  const existingMeasures = extractTodoMeasureMap(existingContent)
  if (incomingMeasures.size === 0 || existingMeasures.size === 0) {
    return false
  }
  for (const [unitKey, incomingValue] of incomingMeasures) {
    if (!existingMeasures.has(unitKey)) continue
    const existingValue = existingMeasures.get(unitKey)!
    if (Math.abs(incomingValue - existingValue) > 1e-6) {
      return true
    }
  }
  return false
}

function duplicateSimilarityThreshold(documentType: DocumentType | undefined): number {
  return documentType === 'todo' ? DUPLICATE_THRESHOLD_TODO : DUPLICATE_THRESHOLD
}

export async function checkForDuplicate(
  content: string,
  options?: CheckDuplicateOptions,
): Promise<LoreDocument | null> {
  const embedding = await embedText(content)
  const results = await searchSimilar(embedding, DUPLICATE_VECTOR_SEARCH_LIMIT)

  if (results.length === 0) return null

  const canonicalIncoming = canonicalizeJsonFromNoteText(content)
  if (canonicalIncoming !== null) {
    for (const row of results) {
      const document = rowToLoreDoc(row as unknown as Record<string, unknown>)
      const canonicalExisting = canonicalizeJsonFromNoteText(document.content)
      if (
        canonicalExisting !== null
        && canonicalExisting === canonicalIncoming
      ) {
        return document
      }
    }
  }

  const documentType = options?.documentType
  const threshold = duplicateSimilarityThreshold(documentType)

  for (const row of results) {
    const candidate = rowToLoreDoc(row as unknown as Record<string, unknown>)
    const distance = '_distance' in row
      ? (row as Record<string, unknown>)._distance as number
      : 1
    const similarity = 1 - distance
    if (similarity < threshold) {
      continue
    }
    if (documentType === 'todo' && todoMeasuresConflict(content, candidate.content)) {
      continue
    }
    return candidate
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

  const tagged = boostByTags(scored, options?.tags ?? [])
  const boosted = boostByLexicalOverlap(tagged, query).sort((left, right) => right.score - left.score)

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
  const queryTextForLexical = queries.join('\n')
  const tagged = boostByTags(merged, options?.tags ?? [])
  const scored = boostByLexicalOverlap(tagged, queryTextForLexical).sort(
    (left, right) => right.score - left.score,
  )

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
