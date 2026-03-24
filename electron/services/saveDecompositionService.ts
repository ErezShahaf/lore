import { generateStructuredResponse } from './ollamaService'
import { getSettings } from './settingsService'
import { loadSkill } from './skillLoader'
import { logger } from '../logger'
import { appendUserInstructionsToSystemPrompt } from './userInstructionsContext'
import type {
  DecomposedDocumentType,
  DecomposedItem,
  SaveDecompositionResult,
  ConversationEntry,
  SaveShapePlan,
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
  shapePlan?: SaveShapePlan | null,
  userInstructionsBlock: string = '',
): Promise<SaveDecompositionResult> {
  const settings = getSettings()
  const systemPrompt = appendUserInstructionsToSystemPrompt(loadSkill('save-items'), userInstructionsBlock)

  const shapeBlock =
    shapePlan !== undefined && shapePlan !== null
      ? `Shape plan (from upstream agent):\n${JSON.stringify(shapePlan)}\n\n`
      : ''

  const decompositionInput = `${shapeBlock}User message to decompose:\n${userInput}`

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
      validate: (parsed) => ({ items: validateItems(parsed.items, userInput, decompositionInput) }),
    })
    const validatedResult = {
      items: validateItems(result.items, userInput, decompositionInput),
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

const USER_MESSAGE_HEADER = 'User message to decompose:'
const SHAPE_PLAN_HEADER = 'Shape plan (from upstream agent):'

function sanitizeContentIfPromptEcho(content: string, userInput: string): string {
  const trimmed = content.trim()
  const headerIndex = trimmed.indexOf(USER_MESSAGE_HEADER)
  if (headerIndex >= 0) {
    const afterHeader = trimmed.slice(headerIndex + USER_MESSAGE_HEADER.length).trim()
    if (afterHeader.length > 0) return afterHeader
  }
  if (trimmed.startsWith(SHAPE_PLAN_HEADER) || trimmed.includes(`\n${USER_MESSAGE_HEADER}\n`)) {
    return userInput.trim()
  }
  return trimmed
}

function validateItems(
  rawItems: unknown,
  userInput: string,
  decompositionInput: string,
): DecomposedItem[] {
  const fallbackContent = userInput.trim()
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return [buildFallbackItem(fallbackContent)]
  }

  const items: DecomposedItem[] = rawItems
    .filter((item): item is Record<string, unknown> =>
      typeof item === 'object' && item !== null && typeof (item as Record<string, unknown>).content === 'string',
    )
    .map((item) => {
      const rawTags = Array.isArray(item.tags)
        ? (item.tags as unknown[]).filter((tag): tag is string => typeof tag === 'string')
        : []
      const type = resolveDocumentType(item.type, decompositionInput, rawTags)
      let rawContent = (item.content as string).trim()
      rawContent = sanitizeContentIfPromptEcho(rawContent, userInput)

      return {
        content: rawContent,
        type,
        tags: ensureDefaultTags(type, rawTags),
      }
    })
    .filter((item) => item.content.length > 0)

  if (items.length === 0) {
    return [buildFallbackItem(fallbackContent)]
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
