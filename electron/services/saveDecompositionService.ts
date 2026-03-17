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
const EXPLICIT_TYPED_LIST_PATTERN = /^\s*(todos?|tasks?|notes?|ideas?|reminders?|meetings?)\s*:\s*(.+)$/is

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
    .map((item) => ({
      content: (item.content as string).trim(),
      type: resolveDocumentType(item.type, originalInput, Array.isArray(item.tags) ? item.tags : []),
      tags: Array.isArray(item.tags)
        ? (item.tags as unknown[]).filter((t): t is string => typeof t === 'string')
        : [],
    }))
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

  const type = inferDocumentTypeFromPrefix(match[1])
  const rawListContent = match[2].trim()
  const items = splitExplicitListContent(rawListContent)
    .map((content) => ({
      content,
      type,
      tags: getDefaultTags(type),
    }))

  return items.length > 0 ? { items } : null
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
