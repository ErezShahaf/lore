import { v4 as uuidv4 } from 'uuid'
import { logger } from '../logger'
import { extractLiteralSearchNeedles } from './needleExtraction'
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

export const DEFAULT_MAX_RESULTS = 1000
const DUPLICATE_THRESHOLD = 0.92
const DUPLICATE_THRESHOLD_TODO = 0.97
const MINIMUM_RELEVANCE_SCORE = 0.24

const TAG_BOOST_FACTOR = 0.32
const LEXICAL_OVERLAP_BOOST_MAX = 0.14
const DEFAULT_LITERAL_SCAN_BUDGET = 500
const LITERAL_NEEDLE_BASE_SCORE = 0.32
export const SEARCH_TOOL_CONTENT_SNIPPET_CHARS = 600

function mergeHybridScoredDocuments(
  vectorDocuments: readonly ScoredDocument[],
  literalDocuments: readonly ScoredDocument[],
): ScoredDocument[] {
  const byId = new Map<string, ScoredDocument>()
  for (const document of vectorDocuments) {
    byId.set(document.id, { ...document })
  }
  for (const document of literalDocuments) {
    const existing = byId.get(document.id)
    if (existing === undefined) {
      byId.set(document.id, { ...document })
    } else {
      byId.set(document.id, {
        ...existing,
        score: Math.max(existing.score, document.score),
      })
    }
  }
  return [...byId.values()].sort((left, right) => right.score - left.score)
}

function literalNeedleScore(documentContent: string, needles: readonly string[]): number {
  if (needles.length === 0) return 0
  const lowerContent = documentContent.toLowerCase()
  let matchedNeedleCount = 0
  for (const needle of needles) {
    if (lowerContent.includes(needle.toLowerCase())) {
      matchedNeedleCount += 1
    }
  }
  if (matchedNeedleCount === 0) return 0
  return LITERAL_NEEDLE_BASE_SCORE + 0.04 * Math.min(matchedNeedleCount, 8)
}

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

/**
 * When hybrid search returns several related notes but the query lexically favors one subset,
 * drop weak tail matches. Skips narrowing when all candidates look equally relevant to the
 * reference text (keeps broad retrieval for generic questions).
 */
export function narrowRetrievedDocumentsByLexicalFocus(
  referenceText: string,
  documents: readonly ScoredDocument[],
): ScoredDocument[] {
  if (documents.length <= 1) {
    return [...documents]
  }
  const trimmedReference = referenceText.trim()
  if (trimmedReference.length < 8) {
    return [...documents]
  }

  const scored = documents.map((document) => ({
    document,
    lexicalRatio: lexicalMatchRatio(trimmedReference, document.content),
  }))
  scored.sort((left, right) => right.lexicalRatio - left.lexicalRatio)
  const bestRatio = scored[0]?.lexicalRatio ?? 0
  const secondRatio = scored[1]?.lexicalRatio ?? 0

  const minimumBestRatio = 0.32
  const minimumLeadOverRunnerUp = 0.14
  if (bestRatio < minimumBestRatio || bestRatio - secondRatio < minimumLeadOverRunnerUp) {
    return [...documents]
  }

  const keepThreshold = Math.max(secondRatio + 0.03, bestRatio - 0.09)
  const keepIds = new Set(
    scored.filter((row) => row.lexicalRatio >= keepThreshold).map((row) => row.document.id),
  )
  if (keepIds.size === 0) {
    return [...documents]
  }
  const filtered = documents.filter((document) => keepIds.has(document.id))
  return filtered.length > 0 ? filtered : [...documents]
}

const DOTTED_STRUCTURED_IDENTIFIER_PATTERN = /\b[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+\b/gi

function extractDottedStructuredIdentifiers(text: string): string[] {
  const matches = text.match(DOTTED_STRUCTURED_IDENTIFIER_PATTERN) ?? []
  return [...new Set(matches.map((token) => token.toLowerCase()))]
}

function buildClassifierDataFocusNeedles(
  data: string,
  situationSummary: string,
): readonly string[] {
  const dataTrimmed = data.trim()
  const summaryTrimmed = situationSummary.trim()
  const combined = `${dataTrimmed}\n${summaryTrimmed}`

  let dottedNeedles = extractDottedStructuredIdentifiers(combined)
  const dottedInDataOnly = extractDottedStructuredIdentifiers(dataTrimmed)
  if (dottedInDataOnly.length > 0) {
    dottedNeedles = dottedInDataOnly
  }

  const needles: string[] = [...dottedNeedles]
  const authorisationFocused =
    /\bauthorisation\b/i.test(combined) || /\bauthorization\b/i.test(combined)
  const captureFocused = /\bcapture\b/i.test(combined)

  if (authorisationFocused && captureFocused) {
    // Leave disambiguation to lexical narrowing when both appear in the router text.
  } else if (authorisationFocused) {
    needles.push('authorisation')
  } else if (captureFocused) {
    needles.push('capture')
  }

  return [...new Set(needles)]
}

function documentContentMatchesFocusNeedle(content: string, needle: string): boolean {
  const lowerContent = content.toLowerCase()
  if (needle === 'authorisation') {
    return lowerContent.includes('authorisation') || lowerContent.includes('authorization')
  }
  if (needle === 'capture') {
    return /\bcapture\b/i.test(content)
  }
  return lowerContent.includes(needle)
}

/**
 * Drops retrieved notes that omit classifier-supplied structured anchors (dotted event ids such as
 * `checkout.session.completed`, or webhook-kind words such as authorisation vs capture). Falls
 * back to the input set when filtering would remove every candidate.
 */
export function narrowRetrievedDocumentsByClassifierFocus(
  classification: { readonly data: string; readonly situationSummary: string },
  documents: readonly ScoredDocument[],
): ScoredDocument[] {
  if (documents.length <= 1) {
    return [...documents]
  }
  const needles = buildClassifierDataFocusNeedles(classification.data, classification.situationSummary)
  if (needles.length === 0) {
    return [...documents]
  }
  const filtered = documents.filter((document) =>
    needles.every((needle) => documentContentMatchesFocusNeedle(document.content, needle)),
  )
  return filtered.length > 0 ? filtered : [...documents]
}

const QUERY_CATEGORY_FOCUS_WORDS: readonly string[] = [
  'restaurant',
  'hotel',
  'cafe',
  'subway',
  'transit',
  'flight',
  'airport',
]

/**
 * When the question names a venue or travel category, drop retrieved notes that lack that category
 * (same city is not enough). Falls back to the full list if nothing would remain.
 */
export function narrowRetrievedDocumentsByQueryCategoryTokens(
  referenceText: string,
  documents: readonly ScoredDocument[],
): ScoredDocument[] {
  if (documents.length <= 1) {
    return [...documents]
  }
  const requiredWords: string[] = []
  for (const word of QUERY_CATEGORY_FOCUS_WORDS) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(referenceText)) {
      requiredWords.push(word)
    }
  }
  if (requiredWords.length === 0) {
    return [...documents]
  }
  const filtered = documents.filter((document) =>
    requiredWords.every((word) => new RegExp(`\\b${word}\\b`, 'i').test(document.content)),
  )
  return filtered.length > 0 ? filtered : [...documents]
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
  /** Reserved for future duplicate flows that need user-instruction context. */
  readonly userInstructionsBlock?: string
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

export function todoMeasuresConflict(incomingContent: string, existingContent: string): boolean {
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

function duplicateCandidateSimilarity(row: Record<string, unknown>): number {
  const distance = '_distance' in row ? (row._distance as number) : 1
  return 1 - distance
}

/**
 * Library rows close enough in embedding space to surface as “similar” before saving.
 * For todos, neighbors that disagree on parsed distance/unit amounts are excluded.
 */
export async function findSimilarDocumentsForSave(
  content: string,
  options?: CheckDuplicateOptions,
): Promise<readonly LoreDocument[]> {
  const embedding = await embedText(content)
  const results = await searchSimilar(embedding, DUPLICATE_VECTOR_SEARCH_LIMIT)

  if (results.length === 0) return []

  const documentType = options?.documentType
  const threshold = duplicateSimilarityThreshold(documentType)

  const seenIds = new Set<string>()
  const similar: LoreDocument[] = []

  for (const row of results) {
    const candidate = rowToLoreDoc(row as unknown as Record<string, unknown>)
    const similarity = duplicateCandidateSimilarity(row as unknown as Record<string, unknown>)
    if (similarity < threshold) {
      continue
    }
    if (documentType === 'todo' && todoMeasuresConflict(content, candidate.content)) {
      continue
    }
    if (seenIds.has(candidate.id)) {
      continue
    }
    seenIds.add(candidate.id)
    similar.push(candidate)
  }

  return similar
}

/** First similar document, if any — used when a single duplicate handle is required (e.g. tools). */
export async function checkForDuplicate(
  content: string,
  options?: CheckDuplicateOptions,
): Promise<LoreDocument | null> {
  const similar = await findSimilarDocumentsForSave(content, options)
  return similar[0] ?? null
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
      '[retrieval] adaptive threshold: top scores (before minimum-score filter)',
    )
  }

  const relevant = keepDocumentsAtOrAboveMinimumRelevanceScore(boosted)

  logger.debug(
    {
      preFilterCandidateCount: boosted.length,
      finalDocumentCount: relevant.length,
      minimumScoreFloor: MINIMUM_RELEVANCE_SCORE,
      note: 'Top scores above are pre-filter; finalDocumentCount is what the question handler uses.',
    },
    '[retrieval] adaptive threshold: after minimum-score filter',
  )

  return {
    documents: relevant,
    totalCandidates: boosted.length,
    cutoffScore: relevant.length > 0 ? relevant[relevant.length - 1].score : 0,
  }
}

/**
 * Vector ANN retrieval plus bounded LanceDB scan for literal needles (from {@link extractLiteralSearchNeedles}).
 */
export async function hybridRetrieveWithAdaptiveThreshold(
  query: string,
  options?: RetrievalOptions,
): Promise<RetrievedDocumentSet> {
  const needles = extractLiteralSearchNeedles(query)
  const vectorResult = await retrieveWithAdaptiveThreshold(query, options)

  if (needles.length === 0) {
    return {
      ...vectorResult,
      retrievalDiagnostics: {
        literalRowsScanned: 0,
        needleCount: 0,
        recallChannel: 'vector_only',
      },
    }
  }

  const filter = buildFilter(options)
  const budget = options?.literalScanBudget ?? DEFAULT_LITERAL_SCAN_BUDGET
  const candidates = await getDocumentsByFilter(filter, budget)

  const literalScored: ScoredDocument[] = []
  for (const document of candidates) {
    const score = literalNeedleScore(document.content, needles)
    if (score <= 0) continue
    literalScored.push({ ...document, score })
  }

  const merged = mergeHybridScoredDocuments(vectorResult.documents, literalScored)
  const tagged = boostByTags(merged, options?.tags ?? [])
  const boosted = boostByLexicalOverlap(tagged, query).sort((left, right) => right.score - left.score)
  const relevant = keepDocumentsAtOrAboveMinimumRelevanceScore(boosted)

  logger.debug(
    {
      needleCount: needles.length,
      literalHitCount: literalScored.length,
      literalRowsScanned: candidates.length,
      mergedPreFilter: boosted.length,
      finalCount: relevant.length,
    },
    '[retrieval] hybrid vector+literal',
  )

  return {
    documents: relevant,
    totalCandidates: boosted.length,
    cutoffScore: relevant.length > 0 ? relevant[relevant.length - 1].score : 0,
    retrievalDiagnostics: {
      literalRowsScanned: candidates.length,
      needleCount: needles.length,
      recallChannel: 'hybrid',
    },
  }
}

export function buildSearchToolDocumentPayload(
  document: ScoredDocument,
  snippetChars: number,
): {
  id: string
  type: string
  date: string
  tags: string[]
  score: number | undefined
  contentSnippet: string
  contentTruncated: boolean
} {
  const content = document.content
  const truncated = content.length > snippetChars
  return {
    id: document.id,
    type: document.type,
    date: document.date,
    tags: document.tags ? document.tags.split(',').filter(Boolean) : [],
    score: document.score,
    contentSnippet: truncated ? `${content.slice(0, snippetChars)}…` : content,
    contentTruncated: truncated,
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

function keepDocumentsAtOrAboveMinimumRelevanceScore(
  results: readonly ScoredDocument[],
): ScoredDocument[] {
  if (results.length === 0) {
    return []
  }
  if (results[0]!.score < MINIMUM_RELEVANCE_SCORE) {
    return []
  }
  return results.filter((document) => document.score >= MINIMUM_RELEVANCE_SCORE)
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

  const relevant = keepDocumentsAtOrAboveMinimumRelevanceScore(scored)

  logger.debug(
    {
      preFilterCandidateCount: scored.length,
      finalDocumentCount: relevant.length,
      minimumScoreFloor: MINIMUM_RELEVANCE_SCORE,
      note: 'Unique docs are pre-filter; finalDocumentCount is what the question handler uses.',
    },
    '[multi-query] after minimum-score filter',
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
