import { chat } from './ollamaService'
import { getSettings } from './settingsService'
import { loadSkill } from './skillLoader'
import { logger } from '../logger'
import type {
  CommandResolution,
  CommandOperation,
  ConversationEntry,
  LoreDocument,
} from '../../shared/types'

const COMMAND_RESOLUTION_SCHEMA = {
  type: 'object',
  properties: {
    status: {
      type: 'string',
      enum: ['execute', 'clarify'],
    },
    operations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          targetDocumentIds: {
            type: 'array',
            items: { type: 'string' },
          },
          action: {
            type: 'string',
            enum: ['delete', 'update'],
          },
          updatedContent: { type: 'string' },
          confidence: { type: 'number' },
          description: { type: 'string' },
        },
        required: ['targetDocumentIds', 'action', 'confidence', 'description'],
      },
    },
    clarificationMessage: { type: 'string' },
  },
  required: ['status'],
}

const MAX_RETRIES = 2
const MIN_OPERATION_CONFIDENCE = 0.5

export async function resolveCommandTargets(
  userInput: string,
  documents: readonly LoreDocument[],
  conversationHistory: readonly ConversationEntry[] = [],
): Promise<CommandResolution> {
  const settings = getSettings()

  const docsForPrompt = documents
    .map((document) => `ID: ${document.id}\nType: ${document.type}\nDate: ${document.date}\nContent: ${document.content}`)
    .join('\n---\n')

  const systemPrompt = loadSkill('command-decomposition')

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
  ]

  for (const entry of conversationHistory) {
    messages.push({ role: entry.role, content: entry.content })
  }

  messages.push({
    role: 'user',
    content: `User wants to: ${userInput}\n\nMatching documents from database:\n${docsForPrompt}`,
  })

  let lastError: unknown

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const stream = chat({
        model: settings.selectedModel,
        messages,
        stream: false,
        format: COMMAND_RESOLUTION_SCHEMA,
        think: false,
      })

      let response = ''
      for await (const chunk of stream) {
        response += chunk
      }

      const parsed = JSON.parse(sanitizeJsonResponse(response))
      const resolution = validateResolution(parsed, documents)

      logger.debug(
        {
          status: resolution.status,
          operationCount: resolution.status === 'execute' ? resolution.operations.length : 0,
        },
        '[CommandDecomposition] Resolved command',
      )

      return resolution
    } catch (error) {
      lastError = error
      logger.warn(
        { error, attempt: attempt + 1, maxRetries: MAX_RETRIES },
        '[CommandDecomposition] Attempt failed',
      )
    }
  }

  logger.error(
    { lastError },
    '[CommandDecomposition] All attempts failed',
  )
  throw new Error(
    `Command decomposition failed after ${MAX_RETRIES} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  )
}

function validateResolution(
  parsed: Record<string, unknown>,
  documents: readonly LoreDocument[],
): CommandResolution {
  if (parsed.status === 'clarify') {
    return {
      status: 'clarify',
      operations: [],
      clarificationMessage: typeof parsed.clarificationMessage === 'string'
        ? parsed.clarificationMessage
        : "I'm not sure which documents you're referring to. Could you be more specific?",
    }
  }

  const validIds = new Set(documents.map((document) => document.id))
  const rawOperations = Array.isArray(parsed.operations) ? parsed.operations : []
  const operations: CommandOperation[] = []

  for (const rawOperation of rawOperations) {
    if (!rawOperation || typeof rawOperation !== 'object') continue

    const targetIds = Array.isArray(rawOperation.targetDocumentIds)
      ? rawOperation.targetDocumentIds.filter(
          (id: unknown): id is string => typeof id === 'string' && validIds.has(id as string),
        )
      : []

    if (targetIds.length === 0) continue

    const action = validateAction(rawOperation.action)
    const confidence = typeof rawOperation.confidence === 'number' ? rawOperation.confidence : 0.5

    if (confidence < MIN_OPERATION_CONFIDENCE) {
      const description = typeof rawOperation.description === 'string' ? rawOperation.description : ''
      return {
        status: 'clarify',
        operations: [],
        clarificationMessage: description
          ? `I'm not confident about this: "${description}". Could you be more specific about which document you mean?`
          : "I'm not sure which documents you're referring to. Could you be more specific?",
      }
    }

    operations.push({
      targetDocumentIds: targetIds,
      action,
      updatedContent: typeof rawOperation.updatedContent === 'string' ? rawOperation.updatedContent : null,
      confidence,
      description: typeof rawOperation.description === 'string' ? rawOperation.description : '',
    })
  }

  if (operations.length === 0) {
    return {
      status: 'clarify',
      operations: [],
      clarificationMessage: "I couldn't determine which documents you're referring to. Could you be more specific?",
    }
  }

  return {
    status: 'execute',
    operations,
    clarificationMessage: null,
  }
}

function validateAction(value: unknown): CommandOperation['action'] {
  const validActions: CommandOperation['action'][] = ['delete', 'update']
  return validActions.includes(value as CommandOperation['action'])
    ? (value as CommandOperation['action'])
    : 'delete'
}

function sanitizeJsonResponse(raw: string): string {
  let cleaned = raw.trim()
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/g, '')
  const first = cleaned.indexOf('{')
  const last = cleaned.lastIndexOf('}')
  if (first !== -1 && last !== -1 && last > first) {
    cleaned = cleaned.slice(first, last + 1)
  }
  return cleaned
}
