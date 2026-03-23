import { generateStructuredResponse } from './ollamaService'
import { formatLocalDate } from './localDate'
import { getSettings } from './settingsService'
import { loadSkill } from './skillLoader'
import { logger } from '../logger'
import { appendUserInstructionsToSystemPrompt } from './userInstructionsContext'
import type {
  ClassificationResult,
  ConversationEntry,
  InputClassification,
} from '../../shared/types'

const UNIFIED_CLASSIFICATION_SCHEMA = {
  type: 'object',
  properties: {
    situationSummary: { type: 'string' },
    intent: {
      type: 'string',
      enum: ['read', 'save', 'edit', 'delete', 'speak'],
    },
    extractedDate: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
    },
    extractedTags: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: [
    'situationSummary',
    'intent',
    'extractedDate',
    'extractedTags',
  ],
  additionalProperties: false,
}

const VALID_INTENTS: readonly InputClassification[] = [
  'read',
  'save',
  'edit',
  'delete',
  'speak',
]

function getMondayOfWeek(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? 6 : day - 1
  d.setDate(d.getDate() - diff)
  return d
}

function buildSystemPrompt(now: Date): string {
  const currentDate = formatLocalDate(now)
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const thisMonday = getMondayOfWeek(now)
  const lastMonday = new Date(thisMonday)
  lastMonday.setDate(lastMonday.getDate() - 7)
  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

  const section = loadSkill('skill-classification')
  return section
    .replace(/\{currentDate\}/g, currentDate)
    .replace('{currentDay}', DAY_NAMES[now.getDay()])
    .replace('{yesterdayDate}', formatLocalDate(yesterday))
    .replace('{thisWeekStart}', formatLocalDate(thisMonday))
    .replace('{lastWeekStart}', formatLocalDate(lastMonday))
}

function validateIntent(value: unknown): InputClassification {
  return VALID_INTENTS.includes(value as InputClassification)
    ? (value as InputClassification)
    : 'speak'
}

function validateClassification(parsed: Record<string, unknown>): ClassificationResult {
  const intent = validateIntent(parsed.intent)
  return {
    intent,
    extractedDate:
      typeof parsed.extractedDate === 'string' && parsed.extractedDate !== ''
        ? parsed.extractedDate
        : null,
    extractedTags: Array.isArray(parsed.extractedTags)
      ? parsed.extractedTags.filter((tag): tag is string => typeof tag === 'string')
      : [],
    situationSummary: typeof parsed.situationSummary === 'string' ? parsed.situationSummary : '',
  }
}

const MAX_RETRIES = 2

export async function classifyInputUnified(
  userInput: string,
  conversationHistory: readonly ConversationEntry[] = [],
  userInstructionsBlock: string = '',
): Promise<ClassificationResult> {
  const settings = getSettings()
  const now = new Date()
  const systemPrompt = appendUserInstructionsToSystemPrompt(
    buildSystemPrompt(now),
    userInstructionsBlock,
  )

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
  ]

  for (const entry of conversationHistory) {
    messages.push({ role: entry.role, content: entry.content })
  }

  messages.push({ role: 'user', content: userInput })

  try {
    const classification = await generateStructuredResponse({
      model: settings.selectedModel,
      messages,
      schema: UNIFIED_CLASSIFICATION_SCHEMA,
      maxAttempts: MAX_RETRIES,
      validate: validateClassification,
      think: false,
    })
    logger.debug(
      {
        event: 'classification_decision',
        decision: classification,
      },
      '[UnifiedClassifier] Decision',
    )
    return classification
  } catch (error) {
    logger.warn({ error }, '[UnifiedClassifier] Classification failed, using fallback')
    return {
      intent: 'speak',
      extractedDate: null,
      extractedTags: [],
      situationSummary: '',
    }
  }
}
