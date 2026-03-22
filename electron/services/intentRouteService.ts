import { generateStructuredResponse } from './ollamaService'
import { getSettings } from './settingsService'
import { loadSkill } from './skillLoader'
import { appendUserInstructionsToSystemPrompt } from './userInstructionsContext'
import type { ConversationEntry, IntentRouteResult, InputClassification, SituationSummary } from '../../shared/types'

const INTENT_ROUTE_SCHEMA = {
  type: 'object',
  properties: {
    intent: {
      type: 'string',
      enum: ['thought', 'question', 'command', 'instruction', 'conversational'],
    },
    confidence: { type: 'number' },
    reasoning: { type: 'string' },
  },
  required: ['intent', 'confidence', 'reasoning'],
  additionalProperties: false,
}

const MAX_RETRIES = 3

export async function routeIntent(
  situation: SituationSummary,
  userInput: string,
  conversationHistory: readonly ConversationEntry[] = [],
  userInstructionsBlock: string = '',
): Promise<IntentRouteResult> {
  const settings = getSettings()
  const systemPrompt = appendUserInstructionsToSystemPrompt(loadSkill('intent-route'), userInstructionsBlock)

  const situationBlock = [
    'Situation summary:',
    situation.situationSummary || '(none)',
    `Assistant recently asked for clarification: ${situation.assistantRecentlyAskedForClarification ? 'yes' : 'no'}`,
  ].join('\n')

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
  ]

  for (const entry of conversationHistory) {
    messages.push({ role: entry.role, content: entry.content })
  }

  messages.push({
    role: 'user',
    content: `${situationBlock}\n\nLast user message:\n${userInput}`,
  })

  return await generateStructuredResponse({
    model: settings.selectedModel,
    messages,
    schema: INTENT_ROUTE_SCHEMA,
    maxAttempts: MAX_RETRIES,
    validate: validateIntentRoute,
  })
}

function validateIntent(value: unknown): InputClassification {
  const valid: InputClassification[] = [
    'thought',
    'question',
    'command',
    'instruction',
    'conversational',
  ]
  return valid.includes(value as InputClassification)
    ? (value as InputClassification)
    : 'conversational'
}

function validateIntentRoute(parsed: Record<string, unknown>): IntentRouteResult {
  const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.5
  return {
    intent: validateIntent(parsed.intent),
    confidence,
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
  }
}
