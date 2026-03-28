import { generateStructuredResponse } from './ollamaService'
import { getSettings } from './settingsService'
import { loadSkill } from './skillLoader'
import { appendUserInstructionsToSystemPrompt } from './userInstructionsContext'
import type { ConversationEntry } from '../../shared/types'

export type DuplicatePromptFollowUpResolution =
  | 'add_second_copy'
  | 'replace_existing'
  | 'not_about_duplicate'

const DUPLICATE_FOLLOW_UP_SCHEMA = {
  type: 'object',
  properties: {
    resolution: {
      type: 'string',
      enum: ['add_second_copy', 'replace_existing', 'not_about_duplicate'],
    },
  },
  required: ['resolution'],
  additionalProperties: false,
} as const

export async function resolveDuplicatePromptFollowUp(params: {
  readonly userMessage: string
  readonly conversationHistory: readonly ConversationEntry[]
  readonly userInstructionsBlock: string
  readonly pendingContentPreview: string
}): Promise<DuplicatePromptFollowUpResolution> {
  const settings = getSettings()
  const systemPrompt = appendUserInstructionsToSystemPrompt(
    loadSkill('duplicate-prompt-follow-up'),
    params.userInstructionsBlock,
  )

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
  ]

  for (const entry of params.conversationHistory) {
    messages.push({ role: entry.role, content: entry.content })
  }

  messages.push({
    role: 'user',
    content: [
      'Pending note content preview (what they were trying to store):',
      params.pendingContentPreview.slice(0, 1200),
      '',
      `User's current message: ${params.userMessage}`,
    ].join('\n'),
  })

  const result = await generateStructuredResponse({
    model: settings.selectedModel,
    messages,
    schema: DUPLICATE_FOLLOW_UP_SCHEMA,
    maxAttempts: 2,
    validate: (raw): { resolution: DuplicatePromptFollowUpResolution } => {
      const resolution = raw.resolution
      if (
        resolution === 'add_second_copy'
        || resolution === 'replace_existing'
        || resolution === 'not_about_duplicate'
      ) {
        return { resolution }
      }
      return { resolution: 'not_about_duplicate' }
    },
  })

  return result.resolution
}
