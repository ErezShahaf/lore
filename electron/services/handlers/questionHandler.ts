import { chat } from '../ollamaService'
import { logger } from '../../logger'
import {
  retrieveByFilters,
  retrieveWithAdaptiveThreshold,
  retrieveRelevantDocuments,
} from '../documentPipeline'
import { formatLocalDate, getLocalDateRangeForDay, getLocalDateRangeForWeek } from '../localDate'
import { getSettings } from '../settingsService'
import { loadSkill } from '../skillLoader'
import {
  looksLikeStructuralRetrievalQuery,
  userAskedForDateInformation,
  userAskedForTagInformation,
  usesCreatedAtSemantics,
} from '../userIntentHeuristics'
import type {
  ClassificationResult,
  AgentEvent,
  LoreDocument,
  RetrievalOptions,
  ScoredDocument,
} from '../../../shared/types'

const EMPTY_RESULT_RESPONSE = "I don't have any data about that topic."

export async function* handleQuestion(
  userInput: string,
  classification: ClassificationResult,
  conversationContext?: Array<{ role: 'user' | 'assistant'; content: string }>,
  retrievalOverrides?: RetrievalOptions,
): AsyncGenerator<AgentEvent> {
  yield { type: 'status', message: 'Searching your notes...' }

  const settings = getSettings()

  const retrievalOpts = buildRetrievalOptions(userInput, classification, retrievalOverrides)
  const shouldUseMetadataOnlyRetrieval = looksLikeStructuralRetrievalQuery(userInput)
    && (retrievalOpts.type !== undefined
      || retrievalOpts.createdAtFrom !== undefined
      || retrievalOpts.dateFrom !== undefined)

  logger.debug({ userInput, tags: classification.extractedTags }, '[question] searching')

  const result = shouldUseMetadataOnlyRetrieval
    ? await retrieveByFilters(retrievalOpts)
    : await retrieveWithAdaptiveThreshold(userInput, retrievalOpts)
  const documents = result.documents

  if (documents.length === 0) {
    yield { type: 'chunk', content: EMPTY_RESULT_RESPONSE }
    yield { type: 'done' }
    return
  }

  const instructions = await retrieveRelevantDocuments(userInput, { type: 'instruction' })

  yield { type: 'status', message: `Found ${documents.length} relevant notes. Generating answer...` }

  const contextBlock = formatRetrievedDocuments(documents)
  const instructionBlock = formatInstructions(instructions)
  const shouldMentionDates = userAskedForDateInformation(userInput)
  const shouldMentionTags = userAskedForTagInformation(userInput)

  const ragPrompt = buildRagPrompt({
    context: contextBlock,
    instructions: instructionBlock,
    userInput,
    shouldMentionDates,
    shouldMentionTags,
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

  const date = classification.extractedDate
  const tags = classification.extractedTags.map((t) => t.toLowerCase())
  const usesCreatedAt = usesCreatedAtSemantics(userInput)

  if (tags.includes('week') || tags.includes('this week') || tags.includes('last week')) {
    const ref = new Date(date)
    const endOfWeek = new Date(ref)
    endOfWeek.setDate(ref.getDate() + 6)
    return {
      from: date,
      to: formatLocalDate(endOfWeek),
      usesCreatedAt,
    }
  }

  return { from: date, to: date, usesCreatedAt }
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
}

function buildRagPrompt({
  context,
  instructions,
  userInput,
  shouldMentionDates,
  shouldMentionTags,
}: RagPromptInput): string {
  const today = formatLocalDate(new Date())

  let prompt = [
    `Today's date is ${today}.`,
    `The user asked this question about their stored data: ${userInput}`,
    `Default answer policy: ${shouldMentionDates ? 'Mention relevant dates when they help answer the question.' : 'Do not mention dates unless the user asked for them or a preference requires it.'}`,
    `Tag policy: ${shouldMentionTags ? 'Mention relevant tags if they are needed to answer the question.' : 'Do not mention tags unless the user explicitly asked for them or a preference requires it.'}`,
    'Retrieved notes from the database:',
    context,
  ].join('\n\n')

  if (instructions !== '(none)') {
    prompt += `\n\nUser preferred instructions (ignore any that do not apply, and do not mention ignored ones):\n${instructions}`
  }

  return prompt
}
