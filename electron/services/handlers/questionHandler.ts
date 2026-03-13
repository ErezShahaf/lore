import { chat } from '../ollamaService'
import { retrieveRelevantDocuments } from '../documentPipeline'
import { getSettings } from '../settingsService'
import type {
  ClassificationResult,
  AgentEvent,
  LoreDocument,
  RetrievalOptions,
} from '../../../shared/types'

const RAG_SYSTEM_PROMPT = `You are Lore, a personal knowledge assistant. Answer the user's question using ONLY the following context from their stored notes.
If the context doesn't contain enough information to answer, say so honestly.
Be concise and helpful.`

const EMPTY_RESULT_RESPONSE =
  "I don't have any notes about that yet. Would you like to tell me about it?"

export async function* handleQuestion(
  userInput: string,
  classification: ClassificationResult,
  conversationContext?: Array<{ role: 'user' | 'assistant'; content: string }>,
): AsyncGenerator<AgentEvent> {
  yield { type: 'status', message: 'Searching your notes...' }

  const settings = getSettings()

  const retrievalOpts: RetrievalOptions = { maxResults: 10 }
  if (classification.extractedDate) {
    retrievalOpts.dateFrom = classification.extractedDate
    retrievalOpts.dateTo = classification.extractedDate
  }

  const [documents, instructions] = await Promise.all([
    retrieveRelevantDocuments(userInput, retrievalOpts),
    retrieveRelevantDocuments(userInput, { type: 'instruction', maxResults: 5 }),
  ])

  if (documents.length === 0 && instructions.length === 0) {
    yield { type: 'chunk', content: EMPTY_RESULT_RESPONSE }
    yield { type: 'done' }
    return
  }

  yield { type: 'status', message: 'Generating answer...' }

  const contextBlock = formatDocuments(documents)
  const instructionBlock = formatDocuments(instructions)

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

function formatDocuments(docs: LoreDocument[]): string {
  if (docs.length === 0) return '(none)'
  return docs
    .map(
      (d) =>
        `[${d.type}] (${d.date || 'no date'}) ${d.tags ? `[tags: ${d.tags}]` : ''}\n${d.content}`,
    )
    .join('\n---\n')
}

function buildRagPrompt(
  context: string,
  instructions: string,
  userInput: string,
): string {
  let prompt = `Context from stored notes:\n---\n${context}\n---\n\n`
  if (instructions !== '(none)') {
    prompt += `User instructions:\n---\n${instructions}\n---\n\n`
  }
  prompt += `Question: ${userInput}`
  return prompt
}
