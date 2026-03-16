import { chat } from './ollamaService'
import { logger } from '../logger'
import { getSettings } from './settingsService'
import { loadSkill } from './skillLoader'
import type { ClassificationResult, ConversationEntry } from '../../shared/types'

const CLASSIFICATION_SCHEMA = {
  type: 'object',
  properties: {
    intent: {
      type: 'string',
      enum: ['thought', 'question', 'command', 'instruction', 'conversational'],
    },
    subtype: { type: 'string' },
    extractedDate: { type: 'string' },
    extractedTags: {
      type: 'array',
      items: { type: 'string' },
    },
    confidence: { type: 'number' },
    reasoning: { type: 'string' },
  },
  required: ['intent', 'subtype', 'extractedDate', 'extractedTags', 'confidence', 'reasoning'],
}

const MAX_RETRIES = 3

export async function classifyInput(
  userInput: string,
  conversationHistory: readonly ConversationEntry[] = [],
): Promise<ClassificationResult> {
  const settings = getSettings()
  const now = new Date()
  const systemPrompt = buildSystemPrompt(now)

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
  ]

  for (const entry of conversationHistory) {
    messages.push({ role: entry.role, content: entry.content })
  }

  messages.push({ role: 'user', content: userInput })

  let lastError: unknown

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const stream = chat({
        model: settings.selectedModel,
        messages,
        stream: false,
        format: CLASSIFICATION_SCHEMA,
        think: false,
      })

      let response = ''
      for await (const chunk of stream) {
        response += chunk
      }

      const parsed = JSON.parse(sanitizeJsonResponse(response))

      return {
        intent: validateIntent(parsed.intent),
        subtype: typeof parsed.subtype === 'string' ? parsed.subtype : 'general',
        extractedDate: typeof parsed.extractedDate === 'string' && parsed.extractedDate !== ''
          ? parsed.extractedDate
          : null,
        extractedTags: Array.isArray(parsed.extractedTags)
          ? parsed.extractedTags.filter((t: unknown) => typeof t === 'string')
          : [],
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
        reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
      }
    } catch (err) {
      lastError = err
      logger.warn({ err, attempt: attempt + 1, maxRetries: MAX_RETRIES }, '[Classifier] Attempt failed')
    }
  }

  logger.error('[Classifier] All attempts failed, throwing error')
  throw new Error(
    `Classification failed after ${MAX_RETRIES} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  )
}

function sanitizeJsonResponse(raw: string): string {
  let s = raw.trim()
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/g, '')
  const first = s.indexOf('{')
  const last = s.lastIndexOf('}')
  if (first !== -1 && last !== -1 && last > first) {
    s = s.slice(first, last + 1)
  }
  return s
}

function validateIntent(value: unknown): ClassificationResult['intent'] {
  const valid = ['thought', 'question', 'command', 'instruction', 'conversational']
  return valid.includes(value as string)
    ? (value as ClassificationResult['intent'])
    : 'thought'
}

function toISODate(d: Date): string {
  return d.toISOString().split('T')[0]
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function getMondayOfWeek(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? 6 : day - 1
  d.setDate(d.getDate() - diff)
  return d
}

function buildSystemPrompt(now: Date): string {
  const currentDate = toISODate(now)
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)

  const thisMonday = getMondayOfWeek(now)
  const lastMonday = new Date(thisMonday)
  lastMonday.setDate(lastMonday.getDate() - 7)

  return loadSkill('classification')
    .replace(/\{currentDate\}/g, currentDate)
    .replace('{currentDay}', DAY_NAMES[now.getDay()])
    .replace('{yesterdayDate}', toISODate(yesterday))
    .replace('{thisWeekStart}', toISODate(thisMonday))
    .replace('{lastWeekStart}', toISODate(lastMonday))
}
