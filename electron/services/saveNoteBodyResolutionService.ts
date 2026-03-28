import { generateStructuredResponse } from './ollamaService'
import { getSettings } from './settingsService'
import { loadSkill } from './skillLoader'
import { appendUserInstructionsToSystemPrompt } from './userInstructionsContext'
import type { ConversationEntry } from '../../shared/types'

export type SaveNoteBodyStep = 'store' | 'ask_short_title' | 'clarify_intent'

export interface SaveNoteBodyResolution {
  readonly step: SaveNoteBodyStep
  readonly noteBody: string
}

const SAVE_NOTE_BODY_SCHEMA = {
  type: 'object',
  properties: {
    step: {
      type: 'string',
      enum: ['store', 'ask_short_title', 'clarify_intent'],
    },
    noteBody: { type: 'string' },
  },
  required: ['step', 'noteBody'],
  additionalProperties: false,
} as const

export async function resolveSaveNoteBody(params: {
  readonly handlerPayload: string
  readonly fullTurnUserMessage: string
  readonly conversationHistory: readonly ConversationEntry[]
  readonly routerSituationSummary: string
  readonly userInstructionsBlock: string
}): Promise<SaveNoteBodyResolution> {
  const settings = getSettings()
  const systemPrompt = appendUserInstructionsToSystemPrompt(
    loadSkill('save-note-body-resolution'),
    params.userInstructionsBlock,
  )

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
  ]

  for (const entry of params.conversationHistory) {
    messages.push({ role: entry.role, content: entry.content })
  }

  const summaryLine =
    params.routerSituationSummary.trim().length > 0
      ? `Router situation summary: ${params.routerSituationSummary.trim()}`
      : 'Router situation summary: (none)'

  messages.push({
    role: 'user',
    content: [
      summaryLine,
      '',
      `Handler payload (may be JSON-only): ${params.handlerPayload}`,
      `Full user message for this send: ${params.fullTurnUserMessage}`,
    ].join('\n'),
  })

  const parsed = await generateStructuredResponse({
    model: settings.selectedModel,
    messages,
    schema: SAVE_NOTE_BODY_SCHEMA,
    maxAttempts: 2,
    validate: (raw): SaveNoteBodyResolution => {
      const step = raw.step
      const noteBody = typeof raw.noteBody === 'string' ? raw.noteBody : ''
      if (step === 'store' || step === 'ask_short_title' || step === 'clarify_intent') {
        return { step, noteBody }
      }
      return { step: 'clarify_intent', noteBody: '' }
    },
  })

  if (parsed.step === 'store' && parsed.noteBody.trim().length === 0) {
    return { step: 'clarify_intent', noteBody: '' }
  }

  return parsed
}
