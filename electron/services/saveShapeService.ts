import { generateStructuredResponse } from './ollamaService'
import { getSettings } from './settingsService'
import { loadSkill } from './skillLoader'
import { logger } from '../logger'
import { appendUserInstructionsToSystemPrompt } from './userInstructionsContext'
import type { ConversationEntry, SaveShapePlan } from '../../shared/types'

const SAVE_SHAPE_SCHEMA = {
  type: 'object',
  properties: {
    splitStrategy: {
      type: 'string',
      enum: ['single', 'list', 'verbatim_single'],
    },
    notesForDecomposer: { type: 'string' },
  },
  required: ['splitStrategy', 'notesForDecomposer'],
  additionalProperties: false,
}

const MAX_RETRIES = 2

const FALLBACK_SHAPE: SaveShapePlan = {
  splitStrategy: 'single',
  notesForDecomposer: '',
}

export async function planSaveShape(
  userInput: string,
  conversationHistory: readonly ConversationEntry[] = [],
  userInstructionsBlock: string = '',
): Promise<SaveShapePlan> {
  const settings = getSettings()
  const systemPrompt = appendUserInstructionsToSystemPrompt(loadSkill('save-shape'), userInstructionsBlock)

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
      schema: SAVE_SHAPE_SCHEMA,
      maxAttempts: MAX_RETRIES,
      validate: validateSaveShape,
    })
  } catch (error) {
    logger.warn({ error }, '[SaveShape] Planning failed, using fallback')
    return FALLBACK_SHAPE
  }
}

function validateSaveShape(parsed: Record<string, unknown>): SaveShapePlan {
  const rawStrategy = parsed.splitStrategy
  const splitStrategy =
    rawStrategy === 'list' || rawStrategy === 'verbatim_single' || rawStrategy === 'single'
      ? rawStrategy
      : 'single'

  return {
    splitStrategy,
    notesForDecomposer: typeof parsed.notesForDecomposer === 'string' ? parsed.notesForDecomposer : '',
  }
}
