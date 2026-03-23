import { generateStructuredResponse } from './ollamaService'
import { formatLocalDate } from './localDate'
import { getSettings } from './settingsService'
import { loadSkill } from './skillLoader'
import { logger } from '../logger'
import { appendUserInstructionsToSystemPrompt } from './userInstructionsContext'
import type {
  ConversationEntry,
  InputClassification,
  MetadataExtractionResult,
  SituationSummary,
} from '../../shared/types'

const METADATA_SCHEMA = {
  type: 'object',
  properties: {
    extractedDate: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
    },
    extractedTags: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['extractedDate', 'extractedTags'],
  additionalProperties: false,
}

const MAX_RETRIES = 2

const FALLBACK_METADATA: MetadataExtractionResult = {
  extractedDate: null,
  extractedTags: [],
}

export async function extractMetadata(
  intent: InputClassification,
  situation: SituationSummary,
  userInput: string,
  conversationHistory: readonly ConversationEntry[] = [],
  now: Date = new Date(),
  userInstructionsBlock: string = '',
): Promise<MetadataExtractionResult> {
  const settings = getSettings()
  const systemPrompt = appendUserInstructionsToSystemPrompt(buildMetadataSystemPrompt(now), userInstructionsBlock)

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
  ]

  for (const entry of conversationHistory) {
    messages.push({ role: entry.role, content: entry.content })
  }

  messages.push({
    role: 'user',
    content: [
      `Routed intent (do not change): ${intent}`,
      'Situation summary:',
      situation.situationSummary || '(none)',
      '',
      'Last user message:',
      userInput,
    ].join('\n'),
  })

  try {
    return await generateStructuredResponse({
      model: settings.selectedModel,
      messages,
      schema: METADATA_SCHEMA,
      maxAttempts: MAX_RETRIES,
      validate: (parsed) => validateMetadata(parsed, intent),
    })
  } catch (error) {
    logger.warn({ error }, '[Metadata] Extraction failed, using fallback')
    return FALLBACK_METADATA
  }
}

function validateMetadata(
  parsed: Record<string, unknown>,
  _intent: InputClassification,
): MetadataExtractionResult {
  return {
    extractedDate: typeof parsed.extractedDate === 'string' && parsed.extractedDate !== ''
      ? parsed.extractedDate
      : null,
    extractedTags: Array.isArray(parsed.extractedTags)
      ? parsed.extractedTags.filter((tag): tag is string => typeof tag === 'string')
      : [],
  }
}

function toISODate(d: Date): string {
  return formatLocalDate(d)
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function getMondayOfWeek(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? 6 : day - 1
  d.setDate(d.getDate() - diff)
  return d
}

function buildMetadataSystemPrompt(now: Date): string {
  const currentDate = toISODate(now)
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)

  const thisMonday = getMondayOfWeek(now)
  const lastMonday = new Date(thisMonday)
  lastMonday.setDate(lastMonday.getDate() - 7)

  return loadSkill('metadata-extraction')
    .replace(/\{currentDate\}/g, currentDate)
    .replace('{currentDay}', DAY_NAMES[now.getDay()])
    .replace('{yesterdayDate}', toISODate(yesterday))
    .replace('{thisWeekStart}', toISODate(thisMonday))
    .replace('{lastWeekStart}', toISODate(lastMonday))
}
