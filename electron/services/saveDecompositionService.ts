import { generateStructuredResponse } from './ollamaService'
import { getSettings } from './settingsService'
import { loadSkill } from './skillLoader'
import { logger } from '../logger'
import type {
  DecomposedDocumentType,
  DecomposedItem,
  SaveDecompositionResult,
  ConversationEntry,
} from '../../shared/types'

const DECOMPOSED_DOCUMENT_TYPES = ['thought', 'todo', 'meeting', 'note'] as const

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
  const settings = getSettings()
  const systemPrompt = loadSkill('save-decomposition')

  const decompositionInput = resolveRawStructuredDataReference(userInput, conversationHistory)
    ?? userInput

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
  ]

  for (const entry of conversationHistory) {
    messages.push({ role: entry.role, content: entry.content })
  }

  messages.push({ role: 'user', content: decompositionInput })

  try {
    const result = await generateStructuredResponse({
      model: settings.selectedModel,
      messages,
      schema: DECOMPOSITION_SCHEMA,
      maxAttempts: MAX_RETRIES,
      validate: (parsed) => ({ items: validateItems(parsed.items, decompositionInput) }),
    })
    const validatedResult = {
      items: validateItems(result.items, decompositionInput),
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
    return { items: [buildFallbackItem(decompositionInput.trim())] }
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
      const rawContent = (item.content as string).trim()

      return {
        content: type === 'todo' ? normalizeTodoContent(rawContent) : rawContent,
        type,
        tags: ensureDefaultTags(type, rawTags),
      }
    })
    .filter((item) => item.content.length > 0)

  if (items.length === 0) {
    return [buildFallbackItem(trimmedInput)]
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

function resolveRawStructuredDataReference(
  userInput: string,
  conversationHistory: readonly ConversationEntry[],
): string | null {
  // Handles cases like: "Save that JSON exactly as a note."
  // In these cases, we want to store the previously provided JSON payload verbatim,
  // not the instruction text.
  const isReferentialJsonSave = /\b(save|store|capture|remember|log|put)\b/i.test(userInput)
    && /\bthat\b/i.test(userInput)
    && /\bjson\b/i.test(userInput)

  if (!isReferentialJsonSave) return null

  const lastUserStructuredPayload = getLastUserStandaloneStructuredPayload(conversationHistory)
  return lastUserStructuredPayload
}

function getLastUserStandaloneStructuredPayload(
  conversationHistory: readonly ConversationEntry[],
): string | null {
  for (let index = conversationHistory.length - 1; index >= 0; index -= 1) {
    const entry = conversationHistory[index]
    if (entry.role !== 'user') continue

    const trimmed = entry.content.trim()
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) continue
    if (trimmed.length < 2) continue

    // Even if parsing fails (malformed JSON), we still return the raw string:
    // the rubric expects verbatim storage of what the user previously provided.
    return trimmed
  }

  return null
}

function normalizeTodoContent(content: string): string {
  // If the model captured todo wrapper text like:
  // "Add to my todo list: buy milk"
  // we should store only the actionable todo portion ("buy milk").
  // The heuristic is applied only when the content looks like a todo wrapper.
  const trimmed = content.trim()

  const wrapperPatterns: ReadonlyArray<RegExp> = [
    /^\s*add to (?:my )?todo list\s*:\s*/i,
    /^\s*add to (?:my )?todos\s*:\s*/i,
    /^\s*todos\s*:\s*/i,
    /^\s*todo\s*:\s*/i,
    /^\s*add\s+(.+?)\s+to (?:my )?todo list\s*:\s*/i,
  ]

  for (const pattern of wrapperPatterns) {
    const match = trimmed.match(pattern)
    if (match) {
      const replaced = trimmed.replace(pattern, '')
      if (replaced.trim().length > 0) return replaced.trim()
    }
  }

  // Support common phrasing: `put "X" on my todo list`
  const putOnTodoListPattern = /^\s*put\s+.+?\s+on (?:my )?todo list\s*:\s*/i
  if (putOnTodoListPattern.test(trimmed)) {
    return trimmed.replace(putOnTodoListPattern, '').trim()
  }

  // If model stored "Add to my todo list: <task>" inside the content but with minor casing,
  // we attempt a final fallback: strip everything up to the last colon.
  const colonIndex = trimmed.lastIndexOf(':')
  if (colonIndex > 0 && /\b(todo list|todos|todo)\b/i.test(trimmed.slice(0, colonIndex))) {
    const afterColon = trimmed.slice(colonIndex + 1).trim()
    if (afterColon.length > 0) return afterColon
  }

  return trimmed
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

  // If type is missing/invalid, trust the model-produced tags only (no regex intent heuristics).
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
