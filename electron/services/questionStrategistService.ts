import { generateStructuredResponse } from './ollamaService'
import { getSettings } from './settingsService'
import { loadSkill } from './skillLoader'
import { logger } from '../logger'
import { appendUserInstructionsToSystemPrompt } from './userInstructionsContext'
import type { QuestionStrategyResult } from '../../shared/types'

const STRATEGY_SCHEMA = {
  type: 'object',
  properties: {
    mode: {
      type: 'string',
      enum: ['answer', 'ask_clarification'],
    },
    clarificationMessage: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
    },
  },
  required: ['mode', 'clarificationMessage'],
  additionalProperties: false,
}

const MAX_RETRIES = 2

const FALLBACK_ANSWER: QuestionStrategyResult = {
  mode: 'answer',
  clarificationMessage: null,
}

export function buildDocumentPreviewBlock(
  previews: readonly { readonly id: string; readonly preview: string }[],
): string {
  return previews
    .map((document, index) => `${index + 1}. id=${document.id}\n${document.preview}`)
    .join('\n\n')
}

export async function decideQuestionStrategy(input: {
  readonly userInput: string
  readonly situationSummary: string
  readonly documentPreviews: readonly { readonly id: string; readonly preview: string }[]
  readonly userInstructionsBlock?: string
}): Promise<QuestionStrategyResult> {
  const settings = getSettings()
  const systemPrompt = appendUserInstructionsToSystemPrompt(
    loadSkill('question-strategist'),
    input.userInstructionsBlock ?? '',
  )

  const userContent = [
    'Situation summary:',
    input.situationSummary || '(none)',
    '',
    'User question:',
    input.userInput,
    '',
    'Retrieved document previews:',
    input.documentPreviews.length === 0
      ? '(none)'
      : buildDocumentPreviewBlock(input.documentPreviews),
  ].join('\n')

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ]

  try {
    const result = await generateStructuredResponse({
      model: settings.selectedModel,
      messages,
      schema: STRATEGY_SCHEMA,
      maxAttempts: MAX_RETRIES,
      validate: validateStrategy,
    })
    if (result.mode === 'ask_clarification' && (!result.clarificationMessage || result.clarificationMessage.trim() === '')) {
      return FALLBACK_ANSWER
    }
    return result
  } catch (error) {
    logger.warn({ error }, '[QuestionStrategist] Failed, defaulting to answer')
    return FALLBACK_ANSWER
  }
}

function validateStrategy(parsed: Record<string, unknown>): QuestionStrategyResult {
  const mode = parsed.mode === 'ask_clarification' ? 'ask_clarification' : 'answer'
  const clarificationMessage =
    typeof parsed.clarificationMessage === 'string' ? parsed.clarificationMessage : null

  return {
    mode,
    clarificationMessage,
  }
}
