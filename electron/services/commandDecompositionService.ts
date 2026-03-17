import { generateStructuredResponse } from './ollamaService'
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
          updatedContent: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
          },
          confidence: { type: 'number' },
          description: { type: 'string' },
        },
        required: ['targetDocumentIds', 'action', 'updatedContent', 'confidence', 'description'],
        additionalProperties: false,
      },
    },
    clarificationMessage: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
    },
  },
  required: ['status', 'operations', 'clarificationMessage'],
  additionalProperties: false,
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

  try {
    const resolution = await generateStructuredResponse({
      model: settings.selectedModel,
      messages,
      schema: COMMAND_RESOLUTION_SCHEMA,
      maxAttempts: MAX_RETRIES,
      validate: (parsed) => validateResolution(parsed, documents),
    })

    logger.debug(
      {
        status: resolution.status,
        operationCount: resolution.status === 'execute' ? resolution.operations.length : 0,
      },
      '[CommandDecomposition] Resolved command',
    )

    return resolution
  } catch (error) {
    logger.error(
      { error },
      '[CommandDecomposition] All attempts failed',
    )
    throw new Error(
      `Command decomposition failed after ${MAX_RETRIES} attempts: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
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
