import { chat } from '../ollamaService'
import { getSettings } from '../settingsService'
import { loadSkill } from '../skillLoader'
import { logger } from '../../logger'
import { appendUserInstructionsToSystemPrompt } from '../userInstructionsContext'
import { resolveUiStatusMessage, UiStatusPhase } from '../uiStatusPhraseComposer'
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

export async function* handleConversational(
  userInput: string,
  classification: ClassificationForHandler,
  conversationHistory: readonly ConversationEntry[] = [],
  userInstructionsBlock: string = '',
): AsyncGenerator<AgentEvent> {
  yield {
    type: 'status',
    message: await resolveUiStatusMessage({
      request: { phase: UiStatusPhase.draftingNaturalReply },
      userInstructionsBlock,
    }),
  }

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
    const streamedResponse = yield* streamConversationalResponse(messages, settings.selectedModel)

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
  let didEmitVisibleContent = false

  for await (const chunk of stream) {
    response += chunk
    didEmitVisibleContent = true
    yield { type: 'chunk', content: chunk }
  }

  return { response, didEmitVisibleContent }
}

function normalizeConversationalResponse(userInput: string, response: string): string {
  const trimmedResponse = response.trim()

  if (trimmedResponse.length > 0) {
    return trimmedResponse
  }

  const defaultResponse = "I'm here to help explain how Lore works. Ask me about saving notes, searching your data, managing todos, or changing preferences."
  return defaultResponse
}
