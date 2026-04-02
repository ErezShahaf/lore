import { logger } from '../../logger'
import {
  DEFAULT_MAX_RESULTS,
  lexicalMatchRatio,
  multiQueryRetrieve,
  retrieveByFilters,
  hybridRetrieveWithAdaptiveThreshold,
} from '../documentPipeline'
import { isTodoListingUserIntent } from '../todoListingIntent'
import { formatLocalDate, getLocalDateRangeForDay, getLocalDateRangeForWeek } from '../localDate'
import { getSettings } from '../settingsService'
import { loadSkill } from '../skillLoader'
import { decideQuestionStrategy } from '../questionStrategistService'
import { appendUserInstructionsToSystemPrompt } from '../userInstructionsContext'
import {
  buildNoDocumentsQuestionUserMessage,
  streamQuestionLlmChunks,
} from '../questionAnswerComposition'
import { resolveUiStatusMessage, UiStatusPhase } from '../uiStatusPhraseComposer'
import { noteContainsStructuredPayload } from '../jsonBlobUtils'
import { getDocumentById } from '../lanceService'
import { parseClarificationNumericReply } from '../commandClarificationState'
import {
  setConsumedQuestionFollowUp,
  setPendingQuestionClarification,
  takeConsumedQuestionFollowUp,
} from '../questionClarificationState'
import type {
  ClassificationForHandler,
  AgentEvent,
  LoreDocument,
  RetrievalContextDocument,
  RetrievalOptions,
  ScoredDocument,
} from '../../../shared/types'

/** The answer model receives every retrieved document; the strategist only needs a bounded preview list. */
const STRATEGIST_DOCUMENT_PREVIEW_MAX_COUNT = 28
const STRATEGIST_DOCUMENT_PREVIEW_CHARS = 220

const RECENT_CONVERSATION_QUERY_TAIL_MAX_CHARS = 2500
const RECENT_CONVERSATION_TURNS_FOR_RETRIEVAL_QUERY = 4

function buildStrategistDocumentPreviews(documents: readonly ScoredDocument[]): {
  readonly previews: readonly { readonly id: string; readonly preview: string }[]
  readonly totalCount: number
} {
  const totalCount = documents.length
  const capped = documents.slice(0, STRATEGIST_DOCUMENT_PREVIEW_MAX_COUNT)
  const previews = capped.map((document) => ({
    id: document.id,
    preview: document.content.slice(0, STRATEGIST_DOCUMENT_PREVIEW_CHARS),
  }))
  return { previews, totalCount }
}

function mapScoredDocumentsToRetrievalContext(
  documents: readonly ScoredDocument[],
): readonly RetrievalContextDocument[] {
  return documents.map((document) => ({
    id: document.id,
    content: document.content,
    type: document.type,
    date: document.date,
    tags: document.tags,
  }))
}

function narrowDocumentsForQuestionFollowUp(
  followUpInput: string,
  priorUserInput: string,
  candidates: readonly LoreDocument[],
): LoreDocument[] {
  if (candidates.length === 0) {
    return []
  }
  const numericChoice = parseClarificationNumericReply(followUpInput.trim())
  if (
    numericChoice !== null
    && numericChoice >= 1
    && numericChoice <= candidates.length
  ) {
    const chosen = candidates[numericChoice - 1]
    return chosen !== undefined ? [chosen] : []
  }

  const referenceText = `${priorUserInput}\n${followUpInput}`.trim()
  const scored = candidates.map((document) => ({
    document,
    ratio: lexicalMatchRatio(referenceText, document.content),
  }))
  scored.sort((left, right) => right.ratio - left.ratio)
  const best = scored[0]
  if (best === undefined) {
    return []
  }
  if (candidates.length === 1) {
    return [best.document]
  }
  const second = scored[1]
  if (second === undefined) {
    return [best.document]
  }
  if (best.ratio < 0.08) {
    return []
  }
  if (best.ratio - second.ratio >= 0.04) {
    return [best.document]
  }
  return []
}

interface AnswerFromRetrievedNotesParams {
  readonly userInput: string
  readonly classification: ClassificationForHandler
  readonly documents: readonly ScoredDocument[]
  readonly conversationContext?: Array<{ role: 'user' | 'assistant'; content: string }>
  readonly userInstructionsBlock: string
  readonly skipStrategistClarification: boolean
}

async function* answerQuestionFromRetrievedCandidateNotes(
  params: AnswerFromRetrievedNotesParams,
): AsyncGenerator<AgentEvent> {
  const {
    userInput,
    classification,
    documents,
    conversationContext,
    userInstructionsBlock,
    skipStrategistClarification,
  } = params

  yield {
    type: 'status',
    message: await resolveUiStatusMessage({
      request: { phase: UiStatusPhase.searchingNotes },
      userInstructionsBlock,
    }),
  }

  const settings = getSettings()
  const retrievalOpts = buildRetrievalOptions(userInput, classification, undefined)
  const isTodoQuery =
    retrievalOpts.type === 'todo'
    || isTodoListingUserIntent(userInput)
  const questionAnswerSelectors = {
    retrievalStatus: documents.length === 0 ? 'empty' : 'non_empty',
    structuredRetrieved: containsRawStructuredContent(documents) ? 'yes' : 'no',
    todoListing: isTodoQuery ? 'yes' : 'no',
  } as const

  yield {
    type: 'retrieved',
    documentIds: documents.map((document) => document.id),
    totalRetrieved: documents.length,
    totalCandidates: documents.length,
    cutoffScore: documents.length > 0 ? documents[documents.length - 1].score : 1,
  }

  yield {
    type: 'read_retrieval_context',
    documents: mapScoredDocumentsToRetrievalContext(documents),
  }

  yield {
    type: 'status',
    message: await resolveUiStatusMessage({
      request: { phase: UiStatusPhase.pullingAnswerTogether },
      userInstructionsBlock,
    }),
  }

  if (!skipStrategistClarification) {
    yield {
      type: 'status',
      message: await resolveUiStatusMessage({
        request: { phase: UiStatusPhase.choosingAnswerPath },
        userInstructionsBlock,
      }),
    }
    const strategistPreviews = buildStrategistDocumentPreviews(documents)
    const strategy = await decideQuestionStrategy({
      userInput,
      situationSummary: classification.situationSummary,
      documentPreviews: strategistPreviews.previews,
      totalRetrievedDocumentCount: strategistPreviews.totalCount,
      userInstructionsBlock,
      recentConversation: conversationContext,
    })

    if (strategy.mode === 'ask_clarification' && strategy.clarificationMessage) {
      setPendingQuestionClarification({
        priorUserInput: userInput,
        candidateDocumentIds: documents.map((document) => document.id),
        classificationSnapshot: {
          extractedTags: classification.extractedTags,
          extractedDate: classification.extractedDate,
          situationSummary: classification.situationSummary,
          data: classification.data,
        },
      })
      yield {
        type: 'turn_step_summary',
        summary:
          'Read: question strategist chose clarification instead of a direct answer; user was asked to narrow the question.',
      }
      yield { type: 'chunk', content: strategy.clarificationMessage }
      yield { type: 'done' }
      return
    }
  }

  yield {
    type: 'status',
    message: await resolveUiStatusMessage({
      request: {
        phase: UiStatusPhase.writingAnswerFromNotes,
        matchingNoteCount: documents.length,
      },
      userInstructionsBlock,
    }),
  }

  const contextBlock = formatRetrievedDocuments([...documents])
  const shouldMentionDates = classification.extractedDate !== null
  const shouldMentionTags = classification.extractedTags.length > 0

  const ragPrompt = buildRagPrompt({
    context: contextBlock,
    instructions: '(none)',
    userInput,
    situationSummary: classification.situationSummary,
    shouldMentionDates,
    shouldMentionTags,
    documents,
  })
  const ragSystemPrompt = appendUserInstructionsToSystemPrompt(
    loadSkill('question-answer', questionAnswerSelectors),
    userInstructionsBlock,
  )

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
    for await (const chunk of streamQuestionLlmChunks(settings.selectedModel, messages)) {
      yield { type: 'chunk', content: chunk }
    }
    yield {
      type: 'turn_step_summary',
      summary: `Read: streamed grounded answer using ${documents.length} retrieved note(s) in context.`,
    }
  } catch (err) {
    yield {
      type: 'turn_step_summary',
      summary: 'Read: answer model failed after documents were retrieved.',
    }
    yield {
      type: 'error',
      message: err instanceof Error ? err.message : 'Failed to generate answer',
    }
  }

  yield { type: 'done' }
}

export async function* handleQuestion(
  userInput: string,
  classification: ClassificationForHandler,
  conversationContext?: Array<{ role: 'user' | 'assistant'; content: string }>,
  retrievalOverrides?: RetrievalOptions,
  userInstructionsBlock: string = '',
): AsyncGenerator<AgentEvent> {
  const narrowConsumed = takeConsumedQuestionFollowUp()
  if (narrowConsumed !== null) {
    const loaded: LoreDocument[] = []
    for (const id of narrowConsumed.candidateDocumentIds) {
      const document = await getDocumentById(id)
      if (document !== null) {
        loaded.push(document)
      }
    }
    if (loaded.length === 0) {
      setConsumedQuestionFollowUp(narrowConsumed)
    } else {
      const narrowed = narrowDocumentsForQuestionFollowUp(
        narrowConsumed.followUpInput,
        narrowConsumed.priorUserInput,
        loaded,
      )
      const chosenLore = narrowed.length > 0 ? narrowed : loaded
      const scored: ScoredDocument[] = chosenLore.map((document) => ({ ...document, score: 1 }))
      const narrowedClassification: ClassificationForHandler = {
        intent: 'read',
        saveDocumentType: null,
        extractedDate: narrowConsumed.classificationSnapshot.extractedDate,
        extractedTags: [...narrowConsumed.classificationSnapshot.extractedTags],
        situationSummary: narrowConsumed.classificationSnapshot.situationSummary,
        data: narrowConsumed.classificationSnapshot.data,
      }
      yield* answerQuestionFromRetrievedCandidateNotes({
        userInput: narrowConsumed.mergedUserInput,
        classification: narrowedClassification,
        documents: scored,
        conversationContext,
        userInstructionsBlock,
        skipStrategistClarification: scored.length === 1,
      })
      return
    }
  }

  yield {
    type: 'status',
    message: await resolveUiStatusMessage({
      request: { phase: UiStatusPhase.searchingNotes },
      userInstructionsBlock,
    }),
  }

  const settings = getSettings()

  const retrievalOpts = buildRetrievalOptions(userInput, classification, retrievalOverrides)
  const retrievalQueryText = buildRetrievalQueryText(userInput, classification)
  const embeddingRichQueryText = buildEmbeddingRichQueryText(
    userInput,
    classification,
    conversationContext,
  )
  logger.debug(
    {
      userInput,
      retrievalQueryText,
      embeddingRichQueryText,
      tags: classification.extractedTags,
    },
    '[question] searching',
  )

  const isTodoQuery =
    retrievalOpts.type === 'todo'
    || isTodoListingUserIntent(userInput)
  const retrievalOptsForTodo = isTodoQuery ? stripTemporalFilters(retrievalOpts) : retrievalOpts

  const result = isTodoQuery
    ? await retrieveByFilters({
      ...retrievalOptsForTodo,
      type: 'todo',
      maxResults: DEFAULT_MAX_RESULTS,
    })
    : await hybridRetrieveWithAdaptiveThreshold(embeddingRichQueryText, retrievalOpts)

  const fallbackResult = !isTodoQuery && result.documents.length === 0
    ? await multiQueryRetrieve(
      buildQuestionFallbackQueries(embeddingRichQueryText, classification),
      retrievalOpts,
    )
    : result

  const sortedFallbackDocuments = isTodoQuery
    ? sortDocumentsNewestFirstBySemanticDate(fallbackResult.documents)
    : fallbackResult.documents
  const documents = sortedFallbackDocuments

  const questionAnswerSelectors = {
    retrievalStatus: documents.length === 0 ? 'empty' : 'non_empty',
    structuredRetrieved: containsRawStructuredContent(documents) ? 'yes' : 'no',
    todoListing: isTodoQuery ? 'yes' : 'no',
  } as const

  if (documents.length === 0) {
    yield {
      type: 'turn_step_summary',
      summary: 'Read: retrieval returned zero matching documents; answer used the no-library context path.',
    }
    yield {
      type: 'status',
      message: await resolveUiStatusMessage({
        request: { phase: UiStatusPhase.noMatchDraftingAnswer },
        userInstructionsBlock,
      }),
    }
    const ragSystemPrompt = appendUserInstructionsToSystemPrompt(
      loadSkill('question-answer', questionAnswerSelectors),
      userInstructionsBlock,
    )
    const noDocumentsMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: ragSystemPrompt },
    ]
    if (conversationContext) {
      for (const message of conversationContext) {
        noDocumentsMessages.push({ role: message.role, content: message.content })
      }
    }
    noDocumentsMessages.push({
      role: 'user',
      content: buildNoDocumentsQuestionUserMessage({
        situationSummary: classification.situationSummary,
        userInput,
      }),
    })
    try {
      for await (const chunk of streamQuestionLlmChunks(settings.selectedModel, noDocumentsMessages)) {
        yield { type: 'chunk', content: chunk }
      }
    } catch (err) {
      yield {
        type: 'turn_step_summary',
        summary: 'Read: answer model failed while no documents were available.',
      }
      yield {
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to generate answer',
      }
    }
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

  yield {
    type: 'read_retrieval_context',
    documents: mapScoredDocumentsToRetrievalContext(documents),
  }

  yield {
    type: 'status',
    message: await resolveUiStatusMessage({
      request: { phase: UiStatusPhase.pullingAnswerTogether },
      userInstructionsBlock,
    }),
  }

  yield {
    type: 'status',
    message: await resolveUiStatusMessage({
      request: { phase: UiStatusPhase.choosingAnswerPath },
      userInstructionsBlock,
    }),
  }
  const strategistPreviewsMain = buildStrategistDocumentPreviews(documents)
  const strategy = await decideQuestionStrategy({
    userInput,
    situationSummary: classification.situationSummary,
    documentPreviews: strategistPreviewsMain.previews,
    totalRetrievedDocumentCount: strategistPreviewsMain.totalCount,
    userInstructionsBlock,
    recentConversation: conversationContext,
  })

  if (strategy.mode === 'ask_clarification' && strategy.clarificationMessage) {
    setPendingQuestionClarification({
      priorUserInput: userInput,
      candidateDocumentIds: documents.map((document) => document.id),
      classificationSnapshot: {
        extractedTags: classification.extractedTags,
        extractedDate: classification.extractedDate,
        situationSummary: classification.situationSummary,
        data: classification.data,
      },
    })
    yield {
      type: 'turn_step_summary',
      summary:
        'Read: question strategist chose clarification instead of a direct answer; user was asked to narrow the question.',
    }
    yield { type: 'chunk', content: strategy.clarificationMessage }
    yield { type: 'done' }
    return
  }

  yield {
    type: 'status',
    message: await resolveUiStatusMessage({
      request: {
        phase: UiStatusPhase.writingAnswerFromNotes,
        matchingNoteCount: documents.length,
      },
      userInstructionsBlock,
    }),
  }

  const contextBlock = formatRetrievedDocuments(documents)
  const shouldMentionDates = classification.extractedDate !== null
  const shouldMentionTags = classification.extractedTags.length > 0

  const ragPrompt = buildRagPrompt({
    context: contextBlock,
    instructions: '(none)',
    userInput,
    situationSummary: classification.situationSummary,
    shouldMentionDates,
    shouldMentionTags,
    documents,
  })
  const ragSystemPrompt = appendUserInstructionsToSystemPrompt(
    loadSkill('question-answer', questionAnswerSelectors),
    userInstructionsBlock,
  )

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
    for await (const chunk of streamQuestionLlmChunks(settings.selectedModel, messages)) {
      yield { type: 'chunk', content: chunk }
    }
    yield {
      type: 'turn_step_summary',
      summary: `Read: streamed grounded answer using ${documents.length} retrieved note(s) in context.`,
    }
  } catch (err) {
    yield {
      type: 'turn_step_summary',
      summary: 'Read: answer model failed after documents were retrieved.',
    }
    yield {
      type: 'error',
      message: err instanceof Error ? err.message : 'Failed to generate answer',
    }
  }

  yield { type: 'done' }
}

function sortDocumentsNewestFirstBySemanticDate(documents: readonly ScoredDocument[]): ScoredDocument[] {
  return [...documents].sort((left, right) => {
    const leftDate = typeof left.date === 'string' ? left.date : ''
    const rightDate = typeof right.date === 'string' ? right.date : ''
    // ISO-8601 date strings sort lexicographically correctly, so a localeCompare on them works for ordering.
    const comparison = rightDate.localeCompare(leftDate)
    if (comparison !== 0) return comparison
    return right.createdAt.localeCompare(left.createdAt)
  })
}

function stripTemporalFilters(options: RetrievalOptions): RetrievalOptions {
  // Temporal filters can be derived from classifier heuristics, which are noisy for short
  // inputs like greetings. For todo listing, we want the user's stored todos regardless
  // of any accidental inferred time window.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { dateFrom, dateTo, createdAtFrom, createdAtTo, ...rest } = options
  return rest
}

function buildRetrievalQueryText(
  userInput: string,
  classification: ClassificationForHandler,
): string {
  const trimmedInput = userInput.trim()
  const trimmedData = classification.data.trim()
  if (trimmedData.length === 0) return trimmedInput
  if (trimmedData === trimmedInput) return trimmedInput
  return `${trimmedInput}\n${trimmedData}`
}

/**
 * Embeds recent chat into the retrieval string so short or deictic questions
 * (e.g. "what about this topic?") align vector search and lexical narrowing with prior turns.
 */
function buildEmbeddingRichQueryText(
  userInput: string,
  classification: ClassificationForHandler,
  conversationContext?: ReadonlyArray<{ readonly role: 'user' | 'assistant'; readonly content: string }>,
): string {
  const base = buildRetrievalQueryText(userInput, classification)
  if (conversationContext === undefined || conversationContext.length === 0) {
    return base
  }
  const tail = conversationContext.slice(-RECENT_CONVERSATION_TURNS_FOR_RETRIEVAL_QUERY)
  const block = tail.map((entry) => `${entry.role}: ${entry.content}`).join('\n')
  const clipped =
    block.length > RECENT_CONVERSATION_QUERY_TAIL_MAX_CHARS
      ? block.slice(-RECENT_CONVERSATION_QUERY_TAIL_MAX_CHARS)
      : block
  return `${base}\n\nRecent conversation (use only to interpret deictic references such as "this topic" or "that note"):\n${clipped}`
}

function buildQuestionFallbackQueries(
  retrievalQueryText: string,
  classification: ClassificationForHandler,
): string[] {
  const fallbackQueries = [
    retrievalQueryText,
    ...classification.extractedTags.filter((tag) => tag.length >= 4),
  ]

  return [...new Set(fallbackQueries.map((query) => query.trim()).filter((query) => query.length > 0))]
}

// ── Date range resolution ─────────────────────────────────────

interface DateRange {
  from: string
  to: string
  usesCreatedAt: boolean
}

function resolveDateRange(
  userInput: string,
  classification: ClassificationForHandler,
): DateRange | null {
  if (!classification.extractedDate) return null

  // Without regex heuristics, treat any resolved date as a single-day range.
  const date = classification.extractedDate
  return { from: date, to: date, usesCreatedAt: false }
}

function buildRetrievalOptions(
  userInput: string,
  classification: ClassificationForHandler,
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

interface RagPromptInput {
  readonly context: string
  readonly instructions: string
  readonly userInput: string
  readonly situationSummary: string
  readonly shouldMentionDates: boolean
  readonly shouldMentionTags: boolean
  readonly documents: readonly ScoredDocument[]
}

function containsRawStructuredContent(documents: readonly ScoredDocument[]): boolean {
  return documents.some((document) => noteContainsStructuredPayload(document.content))
}

function buildRagPrompt({
  context,
  instructions,
  userInput,
  situationSummary,
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
    'Relevance: Several notes may appear below. Use only material from notes that genuinely answer the user’s question. Completely omit unrelated notes—do not quote them, summarize them, name them, or say that extra unrelated notes were retrieved.',
  ]

  const trimmedSituationSummary = situationSummary.trim()
  if (trimmedSituationSummary !== '') {
    parts.push(
      `Classifier situation summary (use only to judge presentation and user goal; every factual claim must still come from retrieved notes): ${trimmedSituationSummary}`,
    )
  }

  if (hasStructuredContent) {
    parts.push(
      'Structured data: If (and only if) a note that is **relevant** to the answer contains JSON, XML, YAML, or code as stored, include that payload verbatim in a markdown code block when the user should see what they saved. Do **not** dump verbatim structured payloads from notes that are irrelevant to the question—ignore those notes entirely.',
    )
  }

  parts.push('Retrieved notes from the database:', context)

  let prompt = parts.join('\n\n')

  if (instructions !== '(none)') {
    prompt += `\n\nUser preferred instructions (ignore any that do not apply, and do not mention ignored ones):\n${instructions}`
  }

  return prompt
}
