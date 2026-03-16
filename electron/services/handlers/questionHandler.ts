import { chat } from '../ollamaService'
import { logger } from '../../logger'
import {
  retrieveWithAdaptiveThreshold,
  retrieveRelevantDocuments,
} from '../documentPipeline'
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

export async function* handleQuestion(
  userInput: string,
  classification: ClassificationResult,
  conversationContext?: Array<{ role: 'user' | 'assistant'; content: string }>,
  retrievalOverrides?: RetrievalOptions,
): AsyncGenerator<AgentEvent> {
  yield { type: 'status', message: 'Searching your notes...' }

  const settings = getSettings()

  const retrievalOpts: RetrievalOptions = { ...retrievalOverrides }
  const dateRange = resolveDateRange(classification)
  if (dateRange) {
    retrievalOpts.dateFrom = dateRange.from
    retrievalOpts.dateTo = dateRange.to
  }
  if (classification.extractedTags.length > 0) {
    retrievalOpts.tags = classification.extractedTags
  }

  logger.debug({ userInput, tags: classification.extractedTags }, '[question] searching')

  const result = await retrieveWithAdaptiveThreshold(userInput, retrievalOpts)
  const documents = result.documents

  const instructions = await retrieveRelevantDocuments(userInput, { type: 'instruction' })

  if (documents.length === 0 && instructions.length === 0) {
    yield { type: 'chunk', content: EMPTY_RESULT_RESPONSE }
    yield { type: 'done' }
    return
  }

  yield { type: 'status', message: `Found ${documents.length} relevant notes. Generating answer...` }

  const contextBlock = formatGroupedDocuments(documents)
  const instructionBlock = formatInstructions(instructions)

  const ragPrompt = buildRagPrompt(contextBlock, instructionBlock, userInput)
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
}

function resolveDateRange(classification: ClassificationResult): DateRange | null {
  if (!classification.extractedDate) return null

  const date = classification.extractedDate
  const tags = classification.extractedTags.map((t) => t.toLowerCase())

  if (tags.includes('week') || tags.includes('this week') || tags.includes('last week')) {
    const ref = new Date(date)
    const endOfWeek = new Date(ref)
    endOfWeek.setDate(ref.getDate() + 6)
    return {
      from: date,
      to: endOfWeek.toISOString().split('T')[0],
    }
  }

  return { from: date, to: date }
}

// ── Smart document grouping ──────────────────────────────────

function formatGroupedDocuments(docs: ScoredDocument[]): string {
  if (docs.length === 0) return '(none)'

  const byDate = new Map<string, ScoredDocument[]>()
  for (const doc of docs) {
    const dateKey = doc.date || 'Unknown date'
    if (!byDate.has(dateKey)) byDate.set(dateKey, [])
    byDate.get(dateKey)!.push(doc)
  }

  if (byDate.size <= 1) {
    return docs
      .map((d) =>
        `[${d.type}] (${d.date || 'no date'}) ${d.tags ? `[tags: ${d.tags}]` : ''}\n${d.content}`,
      )
      .join('\n---\n')
  }

  const sortedDates = [...byDate.keys()].sort()
  const sections: string[] = []

  for (const date of sortedDates) {
    const dateDocs = byDate.get(date)!
    const formatted = dateDocs.map((d) =>
      `  [${d.type}] ${d.tags ? `[tags: ${d.tags}]` : ''}\n  ${d.content}`,
    )
    sections.push(`**${formatDateLabel(date)}:**\n${formatted.join('\n  ---\n')}`)
  }

  return sections.join('\n\n')
}

function formatDateLabel(dateStr: string): string {
  try {
    const date = new Date(dateStr + 'T00:00:00')
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    const months = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December']
    return `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}`
  } catch {
    return dateStr
  }
}

function formatInstructions(docs: LoreDocument[]): string {
  if (docs.length === 0) return '(none)'
  return docs.map((d) => d.content).join('\n- ')
}

function buildRagPrompt(
  context: string,
  instructions: string,
  userInput: string,
): string {
  const today = new Date().toISOString().split('T')[0]
  let prompt = `
  Today's date is ${today}.
  The user currently has a question for you about their stored data : === USER INPUT === ${userInput} === END OF USER INPUT ===`
  prompt += `we looked for relevant notes in the vector database and found these: === RETRIEVED NOTES FROM DATABASE === ${context} === END OF RETRIEVED NOTES ===`
  if (instructions !== '(none)') {
    prompt += `=== User preferred instructions (if you can't do some of these, safely ignore them, and don't even mention them in the answer): ===- ${instructions} === END OF USER PREFERRED INSTRUCTIONS ===`
  }

  return prompt
}
