import { generateStructuredResponse } from './ollamaService'
import { getSettings } from './settingsService'
import { loadSkill } from './skillLoader'
import { logger } from '../logger'
import { appendUserInstructionsToSystemPrompt } from './userInstructionsContext'
import type { ConversationEntry, SituationSummary } from '../../shared/types'

const SITUATION_SCHEMA = {
  type: 'object',
  properties: {
    situationSummary: { type: 'string' },
    assistantRecentlyAskedForClarification: { type: 'boolean' },
  },
  required: ['situationSummary', 'assistantRecentlyAskedForClarification'],
  additionalProperties: false,
}

const MAX_RETRIES = 2

const FALLBACK_SITUATION: SituationSummary = {
  situationSummary: '',
  assistantRecentlyAskedForClarification: false,
}

export async function synthesizeSituation(
  userInput: string,
  conversationHistory: readonly ConversationEntry[] = [],
  userInstructionsBlock: string = '',
): Promise<SituationSummary> {
  const settings = getSettings()
  const systemPrompt = appendUserInstructionsToSystemPrompt(loadSkill('situation'), userInstructionsBlock)

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
  ]

  for (const entry of conversationHistory) {
    messages.push({ role: entry.role, content: entry.content })
  }

  messages.push({ role: 'user', content: userInput })

  try {
    return await generateStructuredResponse({
      model: settings.selectedModel,
      messages,
      schema: SITUATION_SCHEMA,
      maxAttempts: MAX_RETRIES,
      validate: validateSituation,
    })
  } catch (error) {
    logger.warn({ error }, '[Situation] Synthesis failed, using fallback')
    return FALLBACK_SITUATION
  }
}

function validateSituation(parsed: Record<string, unknown>): SituationSummary {
  return {
    situationSummary: typeof parsed.situationSummary === 'string' ? parsed.situationSummary : '',
    assistantRecentlyAskedForClarification: parsed.assistantRecentlyAskedForClarification === true,
  }
}
