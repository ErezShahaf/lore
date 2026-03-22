import { logger } from '../../logger'
import {
  multiQueryRetrieve,
  retrieveByFilters,
  retrieveWithAdaptiveThreshold,
} from '../documentPipeline'
import { formatLocalDate, getLocalDateRangeForDay, getLocalDateRangeForWeek } from '../localDate'
import { getSettings } from '../settingsService'
import { loadSkill } from '../skillLoader'
import { decideQuestionStrategy } from '../questionStrategistService'
import {
  appendUserInstructionsToSystemPrompt,
  instructionDocumentsRequestRichTodoFormatting,
  instructionDocumentsRequestTodoListing,
} from '../userInstructionsContext'
import {
  buildNoDocumentsQuestionUserMessage,
  streamQuestionLlmChunks,
} from '../questionAnswerComposition'
import type {
  ClassificationResult,
  AgentEvent,
  LoreDocument,
  RetrievalOptions,
  ScoredDocument,
} from '../../../shared/types'

// Enough breadth for disambiguation (e.g. multiple Alex / Atlas / webhook notes); the question
// skill chooses clarify vs single-doc answers. Keep within typical eval maxRetrievedCount (~8–12).
const MAX_FOCUSED_ANSWER_DOCUMENTS = 8
const MAX_TODO_DOCUMENTS_FOR_CONVERSATIONAL_INSTRUCTIONS = 6

export async function* handleQuestion(
  userInput: string,
  classification: ClassificationResult,
  conversationContext?: Array<{ role: 'user' | 'assistant'; content: string }>,
  retrievalOverrides?: RetrievalOptions,
  userInstructionDocuments: readonly LoreDocument[] = [],
  userInstructionsBlock: string = '',
): AsyncGenerator<AgentEvent> {
  yield { type: 'status', message: 'Searching your notes and matching filters…' }

  const settings = getSettings()

  const retrievalOpts = buildRetrievalOptions(userInput, classification, retrievalOverrides)
  logger.debug({ userInput, tags: classification.extractedTags }, '[question] searching')

  const isTodoQuery = retrievalOpts.type === 'todo'
  const maxFocusedDocumentsForAnswer = isTodoQuery ? MAX_TODO_DOCUMENTS_FOR_CONVERSATIONAL_INSTRUCTIONS : MAX_FOCUSED_ANSWER_DOCUMENTS
  const retrievalOptsForTodo = isTodoQuery ? stripTemporalFilters(retrievalOpts) : retrievalOpts

  const result = isTodoQuery
    ? await retrieveByFilters({
      ...retrievalOptsForTodo,
      type: 'todo',
      // Grab enough candidates so we can reliably order by stored date.
      // The prompt-context limiter will further trim it.
      maxResults: 50,
    })
    : await retrieveWithAdaptiveThreshold(userInput, retrievalOpts)

  const fallbackResult = !isTodoQuery && result.documents.length === 0
    ? await multiQueryRetrieve(buildQuestionFallbackQueries(userInput, classification), retrievalOpts)
    : result

  const sortedFallbackDocuments = isTodoQuery
    ? sortDocumentsNewestFirstBySemanticDate(fallbackResult.documents)
    : fallbackResult.documents
  let documents = selectDocumentsForAnswer(userInput, sortedFallbackDocuments, maxFocusedDocumentsForAnswer)

  const instructionRequestsTodoListing = instructionDocumentsRequestTodoListing(userInstructionDocuments)

  // Only merge todo documents when this turn is already scoped as a todo retrieval (`todo` tag
  // from metadata). Otherwise, instructions that mention "todo" would prepend every stored todo
  // to unrelated questions (e.g. Stripe after a prior todo turn).
  const shouldMergeTodoDocuments =
    isTodoQuery && userInstructionDocuments.length > 0 && instructionRequestsTodoListing

  // When an instruction explicitly requests todo listing/display (especially for the
  // greeting-triggered scenarios), produce the todo list deterministically from the
  // retrieved todo documents. This avoids the LLM hallucinating or ignoring retrieval.
  // Skip this shortcut when standing instructions ask for rich formatting (e.g. emojis) that
  // requires the answer model.
  const lowerUserInput = userInput.toLowerCase()
  const looksLikeGreeting = lowerUserInput.includes('good morning') || lowerUserInput.startsWith('hello')
  const isDirectTodoQuery = lowerUserInput.includes('todo') || lowerUserInput.includes('todos') || lowerUserInput.includes('tasks')
  const shouldDeterministicallyListTodos =
    instructionRequestsTodoListing
    && !instructionDocumentsRequestRichTodoFormatting(userInstructionDocuments)
    && (looksLikeGreeting || isDirectTodoQuery || classification.subtype === 'greeting')

  if (shouldDeterministicallyListTodos) {
    const todoRetrievalOpts = stripTemporalFilters(retrievalOpts)
    const todoResult = await retrieveByFilters({
      ...todoRetrievalOpts,
      type: 'todo',
      maxResults: 50,
    })

    const sortedTodos = sortDocumentsNewestFirstBySemanticDate(todoResult.documents)
    if (sortedTodos.length === 0) {
      // If there are no todos in storage, fall back to the normal RAG flow
      // so we can produce the correct "no data" response.
    } else {
      const formattedTodos = sortedTodos.map((doc) => `- ${doc.content.trim()}`)

      const greetingPrefix = looksLikeGreeting ? `${userInput.trim()}!\n\n` : ''
      const response = `${greetingPrefix}Here are your todos from newest to oldest:\n\n${formattedTodos.join('\n')}`

      yield { type: 'chunk', content: response }
      yield { type: 'done' }
      return
    }
  }

  const maxFocusedDocuments = shouldMergeTodoDocuments ? MAX_TODO_DOCUMENTS_FOR_CONVERSATIONAL_INSTRUCTIONS : MAX_FOCUSED_ANSWER_DOCUMENTS
  if (shouldMergeTodoDocuments) {
    const todoRetrievalOpts = stripTemporalFilters(retrievalOpts)
    const todoResult = await retrieveByFilters({
      ...todoRetrievalOpts,
      type: 'todo',
      // Pull more candidates, then let the context limiter sort/trim.
      maxResults: 50,
    })

    const sortedTodoDocuments = sortDocumentsNewestFirstBySemanticDate(todoResult.documents)

    const mergedById = new Map<string, ScoredDocument>()
    // Insert todos first so the merged prompt context starts with the ordered todo list.
    for (const todoDoc of sortedTodoDocuments) mergedById.set(todoDoc.id, todoDoc)
    for (const doc of documents) mergedById.set(doc.id, doc)

    documents = selectDocumentsForAnswer(userInput, [...mergedById.values()], maxFocusedDocuments)
  }

  if (documents.length === 0) {
    yield { type: 'status', message: 'No matching notes in your library—drafting a reply…' }
    const ragSystemPrompt = appendUserInstructionsToSystemPrompt(
      loadSkill('question-answer'),
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

  const directStructuredResponse = buildDirectStructuredResponse(userInput, documents)
  if (directStructuredResponse) {
    yield { type: 'chunk', content: directStructuredResponse }
    yield { type: 'done' }
    return
  }

  yield { type: 'status', message: 'Preparing an answer from the retrieved context…' }

  yield { type: 'status', message: 'Deciding whether to answer directly or ask a clarifying question…' }
  const strategy = await decideQuestionStrategy({
    userInput,
    situationSummary: classification.situationSummary,
    documentPreviews: documents.map((document) => ({
      id: document.id,
      preview: document.content.slice(0, 220),
    })),
    userInstructionsBlock,
  })

  if (strategy.mode === 'ask_clarification' && strategy.clarificationMessage) {
    yield { type: 'chunk', content: strategy.clarificationMessage }
    yield { type: 'done' }
    return
  }

  yield {
    type: 'status',
    message: `Writing your answer from ${documents.length} retrieved note(s)…`,
  }

  const contextBlock = formatRetrievedDocuments(documents)
  const shouldMentionDates = classification.extractedDate !== null
  const shouldMentionTags = classification.extractedTags.length > 0

  const ragPrompt = buildRagPrompt({
    context: contextBlock,
    instructions: '(none)',
    userInput,
    shouldMentionDates,
    shouldMentionTags,
    documents,
  })
  const ragSystemPrompt = appendUserInstructionsToSystemPrompt(
    loadSkill('question-answer'),
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
  maxFocusedDocuments: number,
): ScoredDocument[] {
  return documents.slice(0, maxFocusedDocuments)
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

function buildQuestionFallbackQueries(
  userInput: string,
  classification: ClassificationResult,
): string[] {
  const fallbackQueries = [
    userInput,
    ...classification.extractedTags.filter((tag) => tag.length >= 4),
  ]

  return [...new Set(fallbackQueries.map((query) => query.trim()).filter((query) => query.length > 0))]
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
