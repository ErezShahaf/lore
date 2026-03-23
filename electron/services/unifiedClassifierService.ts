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
  ThoughtClarification,
} from '../../shared/types'

const UNIFIED_CLASSIFICATION_SCHEMA = {
  type: 'object',
  properties: {
    situationSummary: { type: 'string' },
    assistantRecentlyAskedForClarification: { type: 'boolean' },
    intent: {
      type: 'string',
      enum: ['thought', 'question', 'command', 'instruction', 'conversational'],
    },
    confidence: { type: 'number' },
    reasoning: { type: 'string' },
    subtype: { type: 'string' },
    extractedDate: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
    },
    extractedTags: {
      type: 'array',
      items: { type: 'string' },
    },
    thoughtClarification: {
      anyOf: [
        {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['clarify', 'suggest_description'] },
            message: { type: 'string' },
          },
          required: ['type', 'message'],
          additionalProperties: false,
        },
        { type: 'null' },
      ],
    },
  },
  required: [
    'situationSummary',
    'assistantRecentlyAskedForClarification',
    'intent',
    'confidence',
    'reasoning',
    'subtype',
    'extractedDate',
    'extractedTags',
    'thoughtClarification',
  ],
  additionalProperties: false,
}

const VALID_INTENTS: readonly InputClassification[] = [
  'thought',
  'question',
  'command',
  'instruction',
  'conversational',
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
    : 'conversational'
}

function validateThoughtClarification(
  parsed: Record<string, unknown>,
  intent: InputClassification,
): ThoughtClarification | null {
  if (intent !== 'thought') return null
  const tc = parsed.thoughtClarification
  if (tc === null || tc === undefined) return null
  if (typeof tc !== 'object') return null
  const obj = tc as Record<string, unknown>
  const type = obj.type === 'clarify' ? 'clarify' : obj.type === 'suggest_description' ? 'suggest_description' : null
  const message = typeof obj.message === 'string' ? obj.message : null
  if (!type || !message) return null
  return { type, message }
}

function validateClassification(parsed: Record<string, unknown>): ClassificationResult {
  const intent = validateIntent(parsed.intent)
  return {
    intent,
    subtype: typeof parsed.subtype === 'string' ? parsed.subtype : 'general',
    extractedDate:
      typeof parsed.extractedDate === 'string' && parsed.extractedDate !== ''
        ? parsed.extractedDate
        : null,
    extractedTags: Array.isArray(parsed.extractedTags)
      ? parsed.extractedTags.filter((tag): tag is string => typeof tag === 'string')
      : [],
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
    situationSummary: typeof parsed.situationSummary === 'string' ? parsed.situationSummary : '',
    thoughtClarification: validateThoughtClarification(parsed, intent),
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
    return await generateStructuredResponse({
      model: settings.selectedModel,
      messages,
      schema: UNIFIED_CLASSIFICATION_SCHEMA,
      maxAttempts: MAX_RETRIES,
      validate: validateClassification,
      think: false,
    })
  } catch (error) {
    logger.warn({ error }, '[UnifiedClassifier] Classification failed, using fallback')
    return {
      intent: 'conversational',
      subtype: 'general',
      extractedDate: null,
      extractedTags: [],
      confidence: 0.5,
      reasoning: 'Fallback due to classification error',
      situationSummary: '',
      thoughtClarification: null,
    }
  }
}
