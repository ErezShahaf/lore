import { chat } from '../ollamaService'
import {
  retrieveWithAdaptiveThreshold,
  retrieveRelevantDocuments,
} from '../documentPipeline'
import { getSettings } from '../settingsService'
import {
  RAG_SYSTEM_PROMPT,
  EMPTY_RESULT_RESPONSE,
} from '../../../prompts'
import type {
  ClassificationResult,
  AgentEvent,
  LoreDocument,
  RetrievalOptions,
  ScoredDocument,
} from '../../../shared/types'

export async function* handleQuestion(
  userInput: string,
  classification: ClassificationResult,
  conversationContext?: Array<{ role: 'user' | 'assistant'; content: string }>,
): AsyncGenerator<AgentEvent> {
  yield { type: 'status', message: 'Searching your notes...' }

  const settings = getSettings()

  const retrievalOpts: RetrievalOptions = {}
  const dateRange = resolveDateRange(classification)
  if (dateRange) {
    retrievalOpts.dateFrom = dateRange.from
    retrievalOpts.dateTo = dateRange.to
  }
  if (classification.extractedTags.length > 0) {
    retrievalOpts.tags = classification.extractedTags
  }

  console.log(`[question] searching "${userInput}" with tags=${JSON.stringify(classification.extractedTags)}`)

  const [result, instructions] = await Promise.all([
    retrieveWithAdaptiveThreshold(userInput, retrievalOpts),
    retrieveRelevantDocuments(userInput, { type: 'instruction', maxResults: 5 }),
  ])

  const documents = result.documents

  if (documents.length === 0 && instructions.length === 0) {
    yield { type: 'chunk', content: EMPTY_RESULT_RESPONSE }
    yield { type: 'done' }
    return
  }

  yield { type: 'status', message: `Found ${documents.length} relevant notes. Generating answer...` }

  const contextBlock = formatGroupedDocuments(documents)
  const instructionBlock = formatInstructions(instructions)

  const ragPrompt = buildRagPrompt(contextBlock, instructionBlock, userInput)

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: RAG_SYSTEM_PROMPT },
  ]

  if (conversationContext) {
    for (const msg of conversationContext.slice(-6)) {
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

// ── Prompt building ───────────────────────────────────────────

function buildRagPrompt(
  context: string,
  instructions: string,
  userInput: string,
): string {
  let prompt = `The user asks: "${userInput}"\n\n`
  prompt += `=== RETRIEVED NOTES FROM DATABASE (this is the ONLY source of truth) ===\n${context}\n=== END OF RETRIEVED NOTES ===\n\n`
  if (instructions !== '(none)') {
    prompt += `User preferences/instructions:\n- ${instructions}\n\n`
  }
  prompt += `Answer using ONLY the retrieved notes above. Use "you/your" (NEVER "I/my") when stating facts about the user. Do not ask follow-up questions — just answer and stop.
  Think logically if the context that we receieved really answers the question or if it is unrelated, you don't need to mention everything you receieved there may be mistakes in the vectordb.
  `
  return prompt
}
