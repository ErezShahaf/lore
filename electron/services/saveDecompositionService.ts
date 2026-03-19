import { generateStructuredResponse } from './ollamaService'
import { getSettings } from './settingsService'
import { loadSkill } from './skillLoader'
import {
  looksLikeExplicitTypedList,
  looksLikeReferentialStorageRequest,
} from './userIntentHeuristics'
import { logger } from '../logger'
import type {
  DecomposedDocumentType,
  DecomposedItem,
  SaveDecompositionResult,
  ConversationEntry,
} from '../../shared/types'

const DECOMPOSED_DOCUMENT_TYPES = ['thought', 'todo', 'meeting', 'note'] as const
const EXPLICIT_TYPED_LIST_PATTERN = /^\s*(?:add\s+to\s+(?:my\s+)?(todos?|todo\s+list|tasks?|notes?|ideas?|reminders?|meetings?)|(todos?|tasks?|notes?|ideas?|reminders?|meetings?))\s*:\s*(.+)$/is
const EMBEDDED_TYPED_LIST_PATTERN = /\b(?:add\s+to\s+(?:my\s+)?(todos?|todo\s+list|tasks?|notes?|ideas?|reminders?|meetings?)|(todos?|tasks?|notes?|ideas?|reminders?|meetings?))\s*:\s*(.+)$/is
const QUOTED_TODO_REQUEST_PATTERN = /\b(?:please\s+)?(?:put|add|save|store|remember|track)\s+["“]([^"”]+)["”]\s+(?:on|to)\s+(?:my\s+)?(?:todo(?:\s+list)?|task\s+list|tasks?|reminders?)\b/i
const TODO_REQUEST_PATTERNS = [
  /\b(?:add|save|store|remember|track)\b[\s\S]{0,160}\b(?:to\s+(?:my\s+)?(?:todo(?:\s+list)?|task\s+list|tasks?|reminders?))\b/i,
  /\bput\b[\s\S]{0,160}\b(?:on|in)\s+(?:my\s+)?(?:todo(?:\s+list)?|task\s+list|tasks?|reminders?)\b/i,
  /\bremind me to\b/i,
] as const

const DECOMPOSITION_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          content: { type: 'string' },
          type: { type: 'string', enum: [...DECOMPOSED_DOCUMENT_TYPES] },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['content', 'type', 'tags'],
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
}

const MAX_RETRIES = 2

export async function decomposeForStorage(
  userInput: string,
  conversationHistory: readonly ConversationEntry[] = [],
): Promise<SaveDecompositionResult> {
  const parsedTypedList = tryParseExplicitTypedList(userInput)
  if (parsedTypedList) {
    return parsedTypedList
  }

  const parsedEmbeddedTypedList = tryParseEmbeddedTypedList(userInput)
  if (parsedEmbeddedTypedList) {
    return parsedEmbeddedTypedList
  }

  const parsedQuotedTodoRequest = tryParseQuotedTodoRequest(userInput)
  if (parsedQuotedTodoRequest) {
    return parsedQuotedTodoRequest
  }

  const settings = getSettings()
  const systemPrompt = loadSkill('save-decomposition')

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
  ]

  for (const entry of conversationHistory) {
    messages.push({ role: entry.role, content: entry.content })
  }

  messages.push({ role: 'user', content: userInput })

  try {
    const result = await generateStructuredResponse({
      model: settings.selectedModel,
      messages,
      schema: DECOMPOSITION_SCHEMA,
      maxAttempts: MAX_RETRIES,
      validate: (parsed) => ({ items: validateItems(parsed.items, userInput) }),
    })
    const validatedResult = {
      items: validateItems(result.items, userInput),
    }

    logger.debug(
      { inputLength: userInput.length, itemCount: validatedResult.items.length },
      '[SaveDecomposition] Decomposed input',
    )

    return validatedResult
  } catch (error) {
    logger.error(
      { error },
      '[SaveDecomposition] All attempts failed, falling back to single item',
    )
    return { items: [buildFallbackItem(userInput.trim())] }
  }
}

function validateItems(rawItems: unknown, originalInput: string): DecomposedItem[] {
  const trimmedInput = originalInput.trim()
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return [buildFallbackItem(trimmedInput)]
  }

  const items: DecomposedItem[] = rawItems
    .filter((item): item is Record<string, unknown> =>
      typeof item === 'object' && item !== null && typeof (item as Record<string, unknown>).content === 'string',
    )
    .map((item) => {
      const rawTags = Array.isArray(item.tags)
        ? (item.tags as unknown[]).filter((tag): tag is string => typeof tag === 'string')
        : []
      const type = resolveDocumentType(item.type, originalInput, rawTags)

      return {
        content: (item.content as string).trim(),
        type,
        tags: ensureDefaultTags(type, rawTags),
      }
    })
    .filter((item) => item.content.length > 0)

  if (items.length === 0) {
    return [buildFallbackItem(trimmedInput)]
  }

  if (items.length === 1 && !looksLikeReferentialStorageRequest(originalInput)) {
    const [item] = items
    return [{
      ...item,
      content: trimmedInput,
      type: resolveDocumentType(item.type, originalInput, item.tags),
    }]
  }

  return items
}

function buildFallbackItem(originalInput: string): DecomposedItem {
  const type = resolveDocumentType(null, originalInput, [])
  return {
    content: originalInput,
    type,
    tags: getDefaultTags(type),
  }
}

function resolveDocumentType(
  rawType: unknown,
  originalInput: string,
  rawTags: readonly unknown[],
): DecomposedDocumentType {
  if (typeof rawType === 'string' && isDecomposedDocumentType(rawType)) {
    return rawType
  }

  const normalizedTags = rawTags
    .filter((tag): tag is string => typeof tag === 'string')
    .map((tag) => tag.toLowerCase())

  if (normalizedTags.includes('todo')) {
    return 'todo'
  }

  if (normalizedTags.includes('meeting')) {
    return 'meeting'
  }

  if (normalizedTags.includes('note')) {
    return 'note'
  }

  return inferDocumentTypeFromInput(originalInput)
}

function inferDocumentTypeFromInput(userInput: string): DecomposedDocumentType {
  const normalizedInput = userInput.trim().toLowerCase()

  if (/^\s*(todos?|tasks?|reminders?)\s*:/.test(normalizedInput)) {
    return 'todo'
  }

  if (TODO_REQUEST_PATTERNS.some((pattern) => pattern.test(normalizedInput))) {
    return 'todo'
  }

  if (/^\s*meetings?\s*:/.test(normalizedInput)) {
    return 'meeting'
  }

  if (/^\s*(notes?|ideas?)\s*:/.test(normalizedInput)) {
    return 'note'
  }

  return 'thought'
}

function getDefaultTags(type: DecomposedDocumentType): string[] {
  if (type === 'thought') {
    return []
  }

  return [type]
}

function ensureDefaultTags(type: DecomposedDocumentType, tags: readonly string[]): string[] {
  const normalizedTags = tags
    .map((tag) => tag.trim().toLowerCase())
    .filter((tag) => tag.length > 0)

  if (normalizedTags.length > 0) {
    return [...new Set(normalizedTags)]
  }

  return getDefaultTags(type)
}

function isDecomposedDocumentType(value: string): value is DecomposedDocumentType {
  return DECOMPOSED_DOCUMENT_TYPES.includes(value as DecomposedDocumentType)
}

function tryParseExplicitTypedList(userInput: string): SaveDecompositionResult | null {
  if (!looksLikeExplicitTypedList(userInput)) {
    return null
  }

  const match = EXPLICIT_TYPED_LIST_PATTERN.exec(userInput)
  if (!match) {
    return null
  }

  const prefix = match[1] || match[2]
  const rawListContent = match[3].trim()
  const type = inferDocumentTypeFromPrefix(prefix)
  const items = splitExplicitListContent(rawListContent)
    .map((content) => ({
      content,
      type,
      tags: getDefaultTags(type),
    }))

  return items.length > 0 ? { items } : null
}

function tryParseEmbeddedTypedList(userInput: string): SaveDecompositionResult | null {
  const match = EMBEDDED_TYPED_LIST_PATTERN.exec(userInput)
  if (!match) {
    return null
  }

  const prefix = match[1] || match[2]
  const rawListContent = match[3].trim()
  const type = inferDocumentTypeFromPrefix(prefix)
  const items = splitExplicitListContent(rawListContent)
    .map((content) => ({
      content,
      type,
      tags: getDefaultTags(type),
    }))

  return items.length > 0 ? { items } : null
}

function tryParseQuotedTodoRequest(userInput: string): SaveDecompositionResult | null {
  const match = QUOTED_TODO_REQUEST_PATTERN.exec(userInput.trim())
  if (!match) {
    return null
  }

  const content = match[1].trim()
  if (content.length === 0) {
    return null
  }

  return {
    items: [{
      content,
      type: 'todo',
      tags: getDefaultTags('todo'),
    }],
  }
}

function inferDocumentTypeFromPrefix(prefix: string): DecomposedDocumentType {
  const normalizedPrefix = prefix.toLowerCase()

  if (normalizedPrefix.startsWith('todo') || normalizedPrefix.startsWith('task') || normalizedPrefix.startsWith('reminder')) {
    return 'todo'
  }

  if (normalizedPrefix.startsWith('meeting')) {
    return 'meeting'
  }

  return 'note'
}

function splitExplicitListContent(rawListContent: string): string[] {
  return rawListContent
    .split(/\r?\n|,/)
    .map((segment) => segment.trim().replace(/^(and|&)\s+/i, ''))
    .filter((segment) => segment.length > 0)
}
