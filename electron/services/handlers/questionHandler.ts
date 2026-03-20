import { chat } from '../ollamaService'
import { logger } from '../../logger'
import {
  multiQueryRetrieve,
  retrieveWithAdaptiveThreshold,
  retrieveRelevantDocuments,
} from '../documentPipeline'
import { formatLocalDate, getLocalDateRangeForDay, getLocalDateRangeForWeek } from '../localDate'
import { getSettings } from '../settingsService'
import { loadSkill } from '../skillLoader'
import type {
  ClassificationResult,
  AgentEvent,
  LoreDocument,
  RetrievalOptions,
  ScoredDocument,
} from '../../../shared/types'

const EMPTY_RESULT_RESPONSE = "I don't have any data about that topic."
const MAX_FOCUSED_ANSWER_DOCUMENTS = 2

export async function* handleQuestion(
  userInput: string,
  classification: ClassificationResult,
  conversationContext?: Array<{ role: 'user' | 'assistant'; content: string }>,
  retrievalOverrides?: RetrievalOptions,
): AsyncGenerator<AgentEvent> {
  yield { type: 'status', message: 'Searching your notes...' }

  const settings = getSettings()

  const retrievalOpts = buildRetrievalOptions(userInput, classification, retrievalOverrides)
  logger.debug({ userInput, tags: classification.extractedTags }, '[question] searching')

  const result = await retrieveWithAdaptiveThreshold(userInput, retrievalOpts)
  const fallbackResult = result.documents.length === 0
    ? await multiQueryRetrieve(buildQuestionFallbackQueries(userInput, classification), retrievalOpts)
    : result
  const documents = selectDocumentsForAnswer(userInput, fallbackResult.documents)

  if (documents.length === 0) {
    yield { type: 'chunk', content: EMPTY_RESULT_RESPONSE }
    yield { type: 'done' }
    return
  }

  yield {
    type: 'retrieved',
    documentIds: documents.map((document) => document.id),
    totalRetrieved: documents.length,
    totalCandidates: fallbackResult.totalCandidates,
    cutoffScore: documents.length > 0 ? documents[documents.length - 1].score : fallbackResult.cutoffScore,
  }

  const clarificationMessage = buildQuestionClarification(userInput, documents)
  if (clarificationMessage) {
    yield { type: 'chunk', content: clarificationMessage }
    yield { type: 'done' }
    return
  }

  const directStructuredResponse = buildDirectStructuredResponse(userInput, documents)
  if (directStructuredResponse) {
    yield { type: 'chunk', content: directStructuredResponse }
    yield { type: 'done' }
    return
  }

  const instructions = await retrieveRelevantDocuments(userInput, { type: 'instruction' })

  yield { type: 'status', message: `Found ${documents.length} relevant notes. Generating answer...` }

  const contextBlock = formatRetrievedDocuments(documents)
  const instructionBlock = formatInstructions(instructions)
  const shouldMentionDates = classification.extractedDate !== null
  const shouldMentionTags = classification.extractedTags.length > 0

  const ragPrompt = buildRagPrompt({
    context: contextBlock,
    instructions: instructionBlock,
    userInput,
    shouldMentionDates,
    shouldMentionTags,
    documents,
  })
  const ragSystemPrompt = loadSkill('question')

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: ragSystemPrompt },
  ]

  if (conversationContext) {
    for (const msg of conversationContext) {
      messages.push({ role: msg.role, content: msg.content })
    }
  }

  messages.push({ role: 'user', content: ragPrompt })

  try {
    const stream = chat({
      model: settings.selectedModel,
      messages,
      stream: true,
      think: false,
    })

    for await (const chunk of stream) {
      yield { type: 'chunk', content: chunk }
    }
  } catch (err) {
    yield {
      type: 'error',
      message: err instanceof Error ? err.message : 'Failed to generate answer',
    }
  }

  yield { type: 'done' }
}

function selectDocumentsForAnswer(
  userInput: string,
  documents: readonly ScoredDocument[],
): ScoredDocument[] {
  const focusedDocuments = filterDocumentsByQueryTerms(userInput, documents)

  if (!shouldLimitAnswerContext(userInput) || focusedDocuments.length <= MAX_FOCUSED_ANSWER_DOCUMENTS) {
    return [...focusedDocuments]
  }

  return focusedDocuments.slice(0, MAX_FOCUSED_ANSWER_DOCUMENTS)
}

function filterDocumentsByQueryTerms(
  userInput: string,
  documents: readonly ScoredDocument[],
): ScoredDocument[] {
  const queryTerms = extractQuestionFocusTerms(userInput)
  if (queryTerms.length === 0 || documents.length <= 1) {
    return [...documents]
  }

  const scoredDocuments = documents.map((document) => ({
    document,
    overlapCount: countMatchingQueryTerms(queryTerms, document.content),
  }))
  const maxOverlapCount = Math.max(...scoredDocuments.map((scoredDocument) => scoredDocument.overlapCount))

  if (maxOverlapCount <= 0) {
    return [...documents]
  }

  const filteredDocuments = scoredDocuments
    .filter((scoredDocument) => scoredDocument.overlapCount === maxOverlapCount)
    .map((scoredDocument) => scoredDocument.document)

  return filteredDocuments.length > 0 ? filteredDocuments : [...documents]
}

function extractQuestionFocusTerms(userInput: string): string[] {
  const ignoredTerms = new Set([
    'about',
    'asked',
    'data',
    'did',
    'find',
    'from',
    'have',
    'list',
    'need',
    'note',
    'remember',
    'search',
    'show',
    'tell',
    'them',
    'they',
    'thing',
    'want',
    'what',
    'which',
    'with',
    'your',
  ])

  const terms = userInput
    .toLowerCase()
    .match(/[a-z0-9]+/g)
    ?.filter((term) => term.length >= 4 && !ignoredTerms.has(term))

  return terms ? [...new Set(terms)] : []
}

function countMatchingQueryTerms(queryTerms: readonly string[], content: string): number {
  const normalizedContent = content.toLowerCase()
  return queryTerms.filter((queryTerm) => normalizedContent.includes(queryTerm)).length
}

function shouldLimitAnswerContext(userInput: string): boolean {
  return !/\b(all|list|show|summarize|everything|all of|todos?|tasks?|notes?)\b/i.test(userInput)
}

function buildQuestionClarification(
  userInput: string,
  documents: readonly ScoredDocument[],
): string | null {
  const structuredClarification = buildStructuredQuestionClarification(userInput, documents)
  if (structuredClarification) {
    return structuredClarification
  }

  const referencedName = extractReferencedName(userInput)
  if (!referencedName || documents.length < 2) {
    return null
  }

  const matchingDocuments = documents.filter((document) =>
    new RegExp(`\\b${escapeRegExp(referencedName)}\\b`, 'i').test(document.content),
  )
  if (matchingDocuments.length < 2) {
    return null
  }

  const previewList = matchingDocuments
    .slice(0, 3)
    .map((document, index) => `${index + 1}. "${truncateContent(document.content, 80)}"`)
    .join('\n')

  return `I found multiple matches for ${referencedName}:\n${previewList}\n\nWhich one did you mean?`
}

function buildQuestionFallbackQueries(
  userInput: string,
  classification: ClassificationResult,
): string[] {
  const fallbackQueries = [
    userInput,
    ...extractStructuredFocusTokens(userInput),
    ...classification.extractedTags.filter((tag) => tag.length >= 4),
  ]

  const focusTerms = extractQuestionFocusTerms(userInput)
  if (focusTerms.length > 1) {
    fallbackQueries.push(focusTerms.join(' '))
  }

  return [...new Set(fallbackQueries.map((query) => query.trim()).filter((query) => query.length > 0))]
}

function extractStructuredFocusTokens(userInput: string): string[] {
  const dottedTerms = userInput.match(/\b[a-z0-9]+(?:[._-][a-z0-9]+)+\b/gi) ?? []
  const uppercaseTerms = userInput.match(/\b[A-Z][A-Z0-9_]{2,}\b/g) ?? []
  return [...new Set([...dottedTerms, ...uppercaseTerms])]
}

function extractReferencedName(userInput: string): string | null {
  const singularNamedReferencePatterns = [
    /\bwhat did\s+([A-Z][a-z]+)\b/i,
    /\bwhat does\s+([A-Z][a-z]+)\b/i,
    /\bwhat about\s+([A-Z][a-z]+)\b/i,
    /\btell me about\s+([A-Z][a-z]+)\b/i,
  ]

  for (const pattern of singularNamedReferencePatterns) {
    const match = userInput.match(pattern)
    if (match?.[1]) {
      return match[1]
    }
  }

  return null
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function truncateContent(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, maxLength)}...`
}

function buildStructuredQuestionClarification(
  userInput: string,
  documents: readonly ScoredDocument[],
): string | null {
  if (documents.length < 2 || !looksLikeStructuredQuestion(userInput, documents)) {
    return null
  }

  const structuredFocusTokens = extractStructuredFocusTokens(userInput)
  const narrowedDocuments = structuredFocusTokens.length === 0
    ? documents
    : documents.filter((document) =>
      structuredFocusTokens.every((token) => document.content.toLowerCase().includes(token.toLowerCase())),
    )

  if (narrowedDocuments.length === 1) {
    return null
  }

  const candidateDocuments = narrowedDocuments.length >= 2 ? narrowedDocuments : documents
  const previewList = candidateDocuments
    .slice(0, 3)
    .map((document, index) => `${index + 1}. "${buildStructuredDocumentPreview(document.content)}"`)
    .join('\n')

  const clarificationQuestion = /\b(json|payload|webhook|event)\b/i.test(userInput)
    ? 'Which event did you mean?'
    : 'Which one did you mean?'

  return `I found multiple matches:\n${previewList}\n\n${clarificationQuestion}`
}

function looksLikeStructuredQuestion(
  userInput: string,
  documents: readonly ScoredDocument[],
): boolean {
  return /\b(json|payload|webhook|endpoint|url)\b/i.test(userInput)
    || containsRawStructuredContent(documents)
}

function buildStructuredDocumentPreview(content: string): string {
  const providerMatch = content.match(/"provider":"([^"]+)"/)
  const eventMatch = content.match(/"(?:event|eventCode)":"([^"]+)"/)
  const urlMatch = content.match(/"url":"([^"]+)"/)
  const previewParts = [providerMatch?.[1], eventMatch?.[1], urlMatch?.[1]].filter(
    (part): part is string => typeof part === 'string' && part.length > 0,
  )

  if (previewParts.length > 0) {
    return previewParts.join(' | ')
  }

  return truncateContent(content, 80)
}

function buildDirectStructuredResponse(
  userInput: string,
  documents: readonly ScoredDocument[],
): string | null {
  if (documents.length !== 1 || !/\b(json|payload)\b/i.test(userInput)) {
    return null
  }

  const content = documents[0].content.trim()
  if (!content.startsWith('{') && !content.startsWith('[')) {
    return null
  }

  return `\`\`\`json\n${content}\n\`\`\``
}

// ── Date range resolution ─────────────────────────────────────

interface DateRange {
  from: string
  to: string
  usesCreatedAt: boolean
}

function resolveDateRange(
  userInput: string,
  classification: ClassificationResult,
): DateRange | null {
  if (!classification.extractedDate) return null

  // Without regex heuristics, treat any resolved date as a single-day range.
  const date = classification.extractedDate
  return { from: date, to: date, usesCreatedAt: false }
}

function buildRetrievalOptions(
  userInput: string,
  classification: ClassificationResult,
  retrievalOverrides?: RetrievalOptions,
): RetrievalOptions {
  const retrievalOptions: RetrievalOptions = { ...retrievalOverrides }
  const dateRange = resolveDateRange(userInput, classification)

  if (dateRange) {
    if (dateRange.usesCreatedAt) {
      const createdAtRange = dateRange.from === dateRange.to
        ? getLocalDateRangeForDay(dateRange.from)
        : getLocalDateRangeForWeek(dateRange.from)
      retrievalOptions.createdAtFrom = createdAtRange.fromIso
      retrievalOptions.createdAtTo = createdAtRange.toIso
    } else {
      retrievalOptions.dateFrom = dateRange.from
      retrievalOptions.dateTo = dateRange.to
    }
  }

  if (classification.extractedTags.length > 0) {
    retrievalOptions.tags = classification.extractedTags
  }

  return retrievalOptions
}

function formatRetrievedDocuments(docs: ScoredDocument[]): string {
  if (docs.length === 0) return '(none)'

  return docs.map((document, index) => {
    const metadataLines = [
      `document_id: ${document.id}`,
      `document_type: ${document.type}`,
      `semantic_date: ${document.date || 'unknown'}`,
      `tags: ${document.tags || '(none)'}`,
    ]

    return [
      `=== DOCUMENT ${index + 1} ===`,
      ...metadataLines,
      'content:',
      document.content,
      `=== END DOCUMENT ${index + 1} ===`,
    ].join('\n')
  }).join('\n\n')
}

function formatInstructions(docs: LoreDocument[]): string {
  if (docs.length === 0) return '(none)'
  return docs.map((d) => `- ${d.content}`).join('\n')
}

interface RagPromptInput {
  readonly context: string
  readonly instructions: string
  readonly userInput: string
  readonly shouldMentionDates: boolean
  readonly shouldMentionTags: boolean
  readonly documents: readonly ScoredDocument[]
}

function containsRawStructuredContent(documents: readonly ScoredDocument[]): boolean {
  return documents.some((document) => {
    const trimmed = document.content.trim()
    return (trimmed.startsWith('{') || trimmed.startsWith('['))
  })
}

function buildRagPrompt({
  context,
  instructions,
  userInput,
  shouldMentionDates,
  shouldMentionTags,
  documents,
}: RagPromptInput): string {
  const today = formatLocalDate(new Date())
  const hasStructuredContent = containsRawStructuredContent(documents)

  const parts = [
    `Today's date is ${today}.`,
    `The user asked this question about their stored data: ${userInput}`,
    `Default answer policy: ${shouldMentionDates ? 'Mention relevant dates when they help answer the question.' : 'Do not mention dates unless the user asked for them or a preference requires it.'}`,
    `Tag policy: ${shouldMentionTags ? 'Mention relevant tags if they are needed to answer the question.' : 'Do not mention tags unless the user explicitly asked for them or a preference requires it.'}`,
  ]

  if (hasStructuredContent) {
    parts.push(
      'IMPORTANT: One or more retrieved notes contain raw structured data (JSON, XML, YAML, or code). You MUST return that content verbatim inside a code block. Do NOT summarize, describe, or extract individual fields from it. Return it exactly as stored.',
    )
  }

  parts.push('Retrieved notes from the database:', context)

  let prompt = parts.join('\n\n')

  if (instructions !== '(none)') {
    prompt += `\n\nUser preferred instructions (ignore any that do not apply, and do not mention ignored ones):\n${instructions}`
  }

  return prompt
}
