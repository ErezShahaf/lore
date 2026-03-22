import { generateStructuredResponse } from './ollamaService'
import { getSettings } from './settingsService'
import { loadSkill } from './skillLoader'
import { appendUserInstructionsToSystemPrompt } from './userInstructionsContext'
import type { ConversationEntry } from '../../shared/types'

export type DuplicateResolutionAction = 'ask' | 'add_new' | 'update'

const DUPLICATE_RESOLUTION_SCHEMA = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ['ask', 'add_new', 'update'],
    },
  },
  required: ['action'],
  additionalProperties: false,
}

export async function resolveDuplicateIntent(
  userInput: string,
  conversationHistory: readonly ConversationEntry[],
  userInstructionsBlock: string = '',
): Promise<DuplicateResolutionAction> {
  const settings = getSettings()
  const systemPrompt = appendUserInstructionsToSystemPrompt(
    loadSkill('duplicate-resolution'),
    userInstructionsBlock,
  )

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
  ]

  for (const entry of conversationHistory) {
    messages.push({ role: entry.role, content: entry.content })
  }

  messages.push({
    role: 'user',
    content: `User's current message: ${userInput}`,
  })

  const result = await generateStructuredResponse({
    model: settings.selectedModel,
    messages,
    schema: DUPLICATE_RESOLUTION_SCHEMA,
    maxAttempts: 2,
    validate: (parsed) => {
      const action = parsed.action
      if (action === 'ask' || action === 'add_new' || action === 'update') {
        return { action }
      }
      return { action: 'ask' as const }
    },
  })

  return result.action
}
