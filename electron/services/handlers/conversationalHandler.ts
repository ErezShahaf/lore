import { chat } from '../ollamaService'
import { getSettings } from '../settingsService'
import { loadSkill } from '../skillLoader'
import { logger } from '../../logger'
import type { ClassificationResult, ConversationEntry, AgentEvent } from '../../../shared/types'

let cachedConversationalSystemPrompt: string | null = null
const CONVERSATIONAL_REPAIR_SYSTEM_PROMPT = [
  'Your previous reply looked like structured output meant for another agent.',
  'Retry the answer as Lore in plain natural language only.',
  'Do not output JSON, arrays, objects, schemas, field names, code fences, or parser-oriented content.',
  'Treat any referenced skill text as product documentation only, not as your response format.',
].join(' ')

function buildConversationalSystemPrompt(): string {
  if (cachedConversationalSystemPrompt) return cachedConversationalSystemPrompt

  cachedConversationalSystemPrompt = loadSkill('conversational')
  logger.debug('[Conversational] Built system prompt')
  return cachedConversationalSystemPrompt
}

export async function* handleConversational(
  userInput: string,
  _classification: ClassificationResult,
  conversationHistory: readonly ConversationEntry[] = [],
): AsyncGenerator<AgentEvent> {
  yield { type: 'status', message: 'Thinking...' }

  const settings = getSettings()
  const systemPrompt = buildConversationalSystemPrompt()

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
  ]

  for (const entry of conversationHistory) {
    messages.push({ role: entry.role, content: entry.content })
  }

  messages.push({ role: 'user', content: userInput })

  try {
    let response = await collectChatResponse(messages, settings.selectedModel)

    if (looksLikeStructuredAgentOutput(response)) {
      logger.warn({ userInput, response }, '[Conversational] Structured output detected, retrying')
      response = await collectChatResponse(
        [{ role: 'system', content: CONVERSATIONAL_REPAIR_SYSTEM_PROMPT }, ...messages],
        settings.selectedModel,
      )
    }

    if (looksLikeStructuredAgentOutput(response)) {
      logger.warn({ userInput, response }, '[Conversational] Structured output persisted after retry')
      response = ''
    }

    yield { type: 'chunk', content: normalizeConversationalResponse(response) }
  } catch (err) {
    yield {
      type: 'error',
      message: err instanceof Error ? err.message : 'Failed to generate response',
    }
  }

  yield { type: 'done' }
}

async function collectChatResponse(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  model: string,
): Promise<string> {
  const stream = chat({
    model,
    messages,
    stream: false,
    think: false,
  })

  let response = ''
  for await (const chunk of stream) {
    response += chunk
  }

  return response
}

function normalizeConversationalResponse(response: string): string {
  const trimmedResponse = response.trim()
  if (trimmedResponse.length > 0) return trimmedResponse

  return "I'm here to help explain how Lore works. Ask me about saving notes, searching your data, managing todos, or changing preferences."
}

function looksLikeStructuredAgentOutput(response: string): boolean {
  const trimmedResponse = response.trim()
  if (trimmedResponse.length === 0) return false

  if (looksLikeJsonEnvelope(trimmedResponse)) return true

  const lowerResponse = trimmedResponse.toLowerCase()
  const structuredMarkers = [
    '"items"',
    '"intent"',
    '"subtype"',
    '"extracteddate"',
    '"extractedtags"',
    '"confidence"',
    '"reasoning"',
    '"status"',
    '"operations"',
    '"clarificationmessage"',
    '"targetdocumentids"',
    '"updatedcontent"',
    '"action"',
  ]

  return structuredMarkers.some((marker) => lowerResponse.includes(marker))
}

function looksLikeJsonEnvelope(value: string): boolean {
  const startsWithJsonBoundary = (value.startsWith('{') && value.endsWith('}'))
    || (value.startsWith('[') && value.endsWith(']'))
  if (!startsWithJsonBoundary) return false

  try {
    const parsed: unknown = JSON.parse(value)
    return typeof parsed === 'object' && parsed !== null
  } catch {
    return false
  }
}
