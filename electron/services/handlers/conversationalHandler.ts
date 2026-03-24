import { chat } from '../ollamaService'
import { getSettings } from '../settingsService'
import { loadSkill } from '../skillLoader'
import { logger } from '../../logger'
import { appendUserInstructionsToSystemPrompt } from '../userInstructionsContext'
import type { ClassificationForHandler, ConversationEntry, AgentEvent } from '../../../shared/types'

let cachedConversationalSkillTemplate: string | null = null

function getConversationalSkillTemplate(): string {
  if (cachedConversationalSkillTemplate === null) {
    cachedConversationalSkillTemplate = loadSkill('skill-worker-conversational')
  }
  return cachedConversationalSkillTemplate
}

function formatRouterContextForConversational(classification: ClassificationForHandler): string {
  const lines: string[] = [`Intent: ${classification.intent}`]
  const summary = classification.situationSummary.trim()
  if (summary.length > 0) {
    lines.push(`Situation summary: ${summary}`)
  }
  if (classification.extractedTags.length > 0) {
    lines.push(`Tags: ${classification.extractedTags.join(', ')}`)
  }
  if (lines.length === 1) {
    lines.push('(No situation summary or tags from the router.)')
  }
  return lines.join('\n')
}

function buildConversationalSystemPrompt(classification: ClassificationForHandler): string {
  const routerBlock = formatRouterContextForConversational(classification)
  return getConversationalSkillTemplate().replace(/\{lastAgentReasoning\}/g, routerBlock)
}

const CONVERSATIONAL_REPAIR_SYSTEM_PROMPT = [
  'Your previous reply looked like structured output meant for another agent.',
  'Retry the answer as Lore in plain natural language only.',
  'Do not output JSON, arrays, objects, schemas, field names, code fences, or parser-oriented content.',
  'Treat any referenced skill text as product documentation only, not as your response format.',
].join(' ')

export async function* handleConversational(
  userInput: string,
  classification: ClassificationForHandler,
  conversationHistory: readonly ConversationEntry[] = [],
  userInstructionsBlock: string = '',
): AsyncGenerator<AgentEvent> {
  yield { type: 'status', message: 'Drafting a conversational reply…' }

  const settings = getSettings()
  const systemPrompt = appendUserInstructionsToSystemPrompt(
    buildConversationalSystemPrompt(classification),
    userInstructionsBlock,
  )
  logger.debug('[Conversational] Built system prompt with router context')

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
  ]

  for (const entry of conversationHistory) {
    messages.push({ role: entry.role, content: entry.content })
  }

  messages.push({ role: 'user', content: userInput })

  try {
    let streamedResponse = yield* streamConversationalResponse(messages, settings.selectedModel)

    if (looksLikeStructuredAgentOutput(streamedResponse.response)) {
      logger.warn({ userInput, response: streamedResponse.response }, '[Conversational] Structured output detected')
      if (!streamedResponse.didEmitVisibleContent) {
        const extracted = tryExtractReplyContent(streamedResponse.response)
        if (extracted !== null) {
          streamedResponse = { response: extracted, didEmitVisibleContent: false }
        } else {
          streamedResponse = {
            response: await collectChatResponse(
              [{ role: 'system', content: CONVERSATIONAL_REPAIR_SYSTEM_PROMPT }, ...messages],
              settings.selectedModel,
            ),
            didEmitVisibleContent: false,
          }
        }
      }
    }

    if (looksLikeStructuredAgentOutput(streamedResponse.response)) {
      logger.warn({ userInput, response: streamedResponse.response }, '[Conversational] Structured output persisted after retry')
      if (!streamedResponse.didEmitVisibleContent) {
        const extractedContent = tryExtractReplyContent(streamedResponse.response)
        streamedResponse = {
          response: extractedContent ?? '',
          didEmitVisibleContent: false,
        }
      }
    }

    // When streaming already emitted visible chunks, the assistant message is complete—do not
    // send the full response again or the UI will append duplicate text.
    if (!streamedResponse.didEmitVisibleContent) {
      yield {
        type: 'chunk',
        content: normalizeConversationalResponse(userInput, streamedResponse.response),
      }
    }
    yield {
      type: 'turn_step_summary',
      summary: streamedResponse.didEmitVisibleContent
        ? 'Speak: conversational reply was streamed to the user in this step.'
        : 'Speak: conversational reply was composed and sent as one message in this step.',
    }
  } catch (err) {
    yield {
      type: 'turn_step_summary',
      summary: 'Speak: conversational model raised an error before a reply could be finished.',
    }
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

interface StreamedConversationalResponse {
  readonly response: string
  readonly didEmitVisibleContent: boolean
}

async function* streamConversationalResponse(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  model: string,
): AsyncGenerator<AgentEvent, StreamedConversationalResponse> {
  const stream = chat({
    model,
    messages,
    stream: true,
    think: false,
  })

  let response = ''
  let pendingResponse = ''
  let didEmitVisibleContent = false

  for await (const chunk of stream) {
    response += chunk

    if (didEmitVisibleContent) {
      yield { type: 'chunk', content: chunk }
      continue
    }

    pendingResponse += chunk
    if (looksLikeStructuredResponsePrefix(pendingResponse)) {
      continue
    }

    didEmitVisibleContent = true
    yield { type: 'chunk', content: pendingResponse }
    pendingResponse = ''
  }

  return { response, didEmitVisibleContent }
}

function tryExtractReplyContent(response: string): string | null {
  const trimmed = response.trim()
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null
  try {
    const parsed = JSON.parse(trimmed) as { action?: string; content?: string }
    if (parsed?.action === 'reply' && typeof parsed.content === 'string') {
      return parsed.content.trim()
    }
  } catch {
    // ignore
  }
  return null
}

function normalizeConversationalResponse(userInput: string, response: string): string {
  const trimmedResponse = response.trim()

  if (trimmedResponse.length > 0) {
    return trimmedResponse
  }

  const defaultResponse = "I'm here to help explain how Lore works. Ask me about saving notes, searching your data, managing todos, or changing preferences."
  return defaultResponse
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
    '"situationsummary"',
    '"splitstrategy"',
    '"assistantrecentlyaskedforclarification"',
    '"mode"',
    '"notesfordecomposer"',
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

function looksLikeStructuredResponsePrefix(response: string): boolean {
  const trimmedResponse = response.trimStart()
  if (trimmedResponse.length === 0) {
    return false
  }

  if (trimmedResponse.startsWith('{')) {
    return true
  }

  const lowerResponse = trimmedResponse.toLowerCase()
  return (
    lowerResponse.startsWith('"intent"')
    || lowerResponse.startsWith('"items"')
    || lowerResponse.startsWith('"status"')
    || lowerResponse.startsWith('"operations"')
  )
}

