import { generateStructuredResponse } from './ollamaService'
import { formatLocalDate } from './localDate'
import { getSettings } from './settingsService'
import { FIRST_TURN_SKILL_ID, loadSkill } from './skillLoader'
import { logger } from '../logger'
import { appendUserInstructionsToSystemPrompt } from './userInstructionsContext'
import type {
  ClassificationResult,
  ClassificationAction,
  ConversationEntry,
  DecomposedDocumentType,
  InputClassification,
} from '../../shared/types'

const ACTION_ITEM_SCHEMA = {
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
    data: { type: 'string' },
    saveDocumentType: {
      anyOf: [
        {
          type: 'string',
          enum: ['thought', 'todo', 'note', 'meeting', 'instruction'],
        },
        { type: 'null' },
      ],
    },
  },
  required: [
    'situationSummary',
    'intent',
    'extractedDate',
    'extractedTags',
    'data',
    'saveDocumentType',
  ],
  additionalProperties: false,
}

const UNIFIED_CLASSIFICATION_SCHEMA = {
  type: 'object',
  properties: {
    actions: {
      type: 'array',
      items: ACTION_ITEM_SCHEMA,
    },
  },
  required: ['actions'],
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

  const section = loadSkill(FIRST_TURN_SKILL_ID)
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

const VALID_DECOMPOSED_TYPES: readonly DecomposedDocumentType[] = [
  'thought',
  'todo',
  'note',
  'meeting',
  'instruction',
]

function parseSaveDocumentType(
  intent: InputClassification,
  raw: unknown,
): DecomposedDocumentType | null {
  if (intent !== 'save') return null
  if (
    typeof raw === 'string'
    && VALID_DECOMPOSED_TYPES.includes(raw as DecomposedDocumentType)
  ) {
    return raw as DecomposedDocumentType
  }
  return 'thought'
}

function validateAction(raw: unknown): ClassificationAction {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return createDefaultAction('speak')
  }
  const obj = raw as Record<string, unknown>
  const intent = validateIntent(obj.intent)
  return {
    intent,
    extractedDate:
      typeof obj.extractedDate === 'string' && obj.extractedDate !== ''
        ? obj.extractedDate
        : null,
    extractedTags: Array.isArray(obj.extractedTags)
      ? (obj.extractedTags as unknown[]).filter((tag): tag is string => typeof tag === 'string')
      : [],
    situationSummary: typeof obj.situationSummary === 'string' ? obj.situationSummary : '',
    data: typeof obj.data === 'string' ? obj.data : '',
    saveDocumentType: parseSaveDocumentType(intent, obj.saveDocumentType),
  }
}

function createDefaultAction(intent: InputClassification): ClassificationAction {
  return {
    intent,
    extractedDate: null,
    extractedTags: [],
    situationSummary: '',
    data: '',
    saveDocumentType: intent === 'save' ? 'thought' : null,
  }
}

function validateClassification(parsed: Record<string, unknown>): ClassificationResult {
  const rawActions = parsed.actions
  if (!Array.isArray(rawActions) || rawActions.length === 0) {
    return { actions: [createDefaultAction('speak')] }
  }
  const actions = rawActions.map((raw) => validateAction(raw))
  return { actions }
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
    return { actions: [createDefaultAction('speak')] }
  }
}
