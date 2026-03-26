import { logger } from '../logger'
import { formatLocalDate } from './localDate'
import { getDocumentById, hardDeleteDocument, updateDocument } from './lanceService'
import { embedText } from './embeddingService'
import {
  checkForDuplicate,
  retrieveByFilters,
  retrieveWithAdaptiveThreshold,
  storeThought,
} from './documentPipeline'
import type { AgentEvent, DocumentType, OllamaTool } from '../../shared/types'

// ── Tool result types ─────────────────────────────────────────

interface SearchResult {
  readonly documents: ReadonlyArray<{
    readonly id: string
    readonly type: string
    readonly date: string
    readonly tags: string[]
    readonly contentPreview: string
    readonly score: number
  }>
  readonly totalFound: number
}

interface GetDocumentResult {
  readonly id: string
  readonly type: string
  readonly date: string
  readonly tags: string[]
  readonly content: string
  readonly createdAt: string
}

interface SaveItemResult {
  readonly id: string
  readonly status: 'saved' | 'duplicate_found'
  readonly duplicatePreview?: string
}

interface ModifyOperationResult {
  readonly documentId: string
  readonly action: string
  readonly status: 'success' | 'not_found'
}

// ── Tool execution context ────────────────────────────────────

export interface ToolExecutionResult {
  readonly output: string
  readonly events: readonly AgentEvent[]
}

type ToolHandler = (args: Record<string, unknown>) => Promise<ToolExecutionResult>

// ── Argument validation helpers ───────────────────────────────

const VALID_DOCUMENT_TYPES: ReadonlySet<string> = new Set([
  'thought', 'todo', 'note', 'meeting', 'instruction',
])

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Missing or empty required string parameter: ${key}`)
  }
  return value.trim()
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') return undefined
  return value.trim() || undefined
}

function optionalNumber(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key]
  if (value === undefined || value === null) return undefined
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return undefined
}

function requireArray(args: Record<string, unknown>, key: string): unknown[] {
  const value = args[key]
  if (!Array.isArray(value)) {
    throw new Error(`Missing or invalid array parameter: ${key}`)
  }
  return value
}

// ── Tool handlers ─────────────────────────────────────────────

async function handleSearchLibrary(args: Record<string, unknown>): Promise<ToolExecutionResult> {
  const query = requireString(args, 'query')
  const type = optionalString(args, 'type') as DocumentType | undefined
  const maxResults = optionalNumber(args, 'maxResults') ?? 10

  if (type && !VALID_DOCUMENT_TYPES.has(type)) {
    return {
      output: JSON.stringify({ error: `Invalid type filter: ${type}` }),
      events: [],
    }
  }

  logger.debug({ query, type, maxResults }, '[ToolRegistry] search_library')

  const isTodoFilterOnly = type === 'todo' && query.toLowerCase().replace(/[^a-z]/g, '') === 'todos'

  const result = isTodoFilterOnly
    ? await retrieveByFilters({ type, maxResults })
    : await retrieveWithAdaptiveThreshold(query, { type, maxResults })

  const documents = result.documents.slice(0, maxResults).map((document) => ({
    id: document.id,
    type: document.type,
    date: document.date,
    tags: document.tags ? document.tags.split(',').filter(Boolean) : [],
    contentPreview: document.content.slice(0, 200),
    score: Math.round(document.score * 1000) / 1000,
  }))

  const output: SearchResult = { documents, totalFound: result.totalCandidates }

  const events: AgentEvent[] = documents.length > 0
    ? [{
        type: 'retrieved' as const,
        documentIds: documents.map((document) => document.id),
        totalRetrieved: documents.length,
        totalCandidates: result.totalCandidates,
      }]
    : []

  return { output: JSON.stringify(output), events }
}

async function handleGetDocument(args: Record<string, unknown>): Promise<ToolExecutionResult> {
  const id = requireString(args, 'id')

  logger.debug({ id: id.slice(0, 8) }, '[ToolRegistry] get_document')

  const document = await getDocumentById(id)
  if (!document) {
    return {
      output: JSON.stringify({ error: `Document not found: ${id}` }),
      events: [],
    }
  }

  const result: GetDocumentResult = {
    id: document.id,
    type: document.type,
    date: document.date,
    tags: document.tags ? document.tags.split(',').filter(Boolean) : [],
    content: document.content,
    createdAt: document.createdAt,
  }

  return { output: JSON.stringify(result), events: [] }
}

async function handleSaveDocuments(args: Record<string, unknown>): Promise<ToolExecutionResult> {
  const items = requireArray(args, 'items')
  const today = formatLocalDate(new Date())
  const events: AgentEvent[] = []
  const results: SaveItemResult[] = []

  for (const raw of items) {
    const item = raw as Record<string, unknown>
    const content = requireString(item, 'content')
    const type = requireString(item, 'type') as DocumentType

    if (!VALID_DOCUMENT_TYPES.has(type)) {
      results.push({ id: '', status: 'saved', duplicatePreview: `Invalid type: ${type}` })
      continue
    }

    const tags = Array.isArray(item.tags)
      ? (item.tags as unknown[]).filter((tag): tag is string => typeof tag === 'string')
      : []
    const date = (typeof item.date === 'string' && item.date.length > 0) ? item.date : today

    const duplicate = await checkForDuplicate(content)
    if (duplicate) {
      const preview = duplicate.content.slice(0, 120)
      results.push({ id: duplicate.id, status: 'duplicate_found', duplicatePreview: preview })
      events.push({ type: 'duplicate', existingContent: preview })
      continue
    }

    const document = await storeThought({
      content,
      originalInput: content,
      type,
      date,
      tags,
    })

    results.push({ id: document.id, status: 'saved' })
    events.push({ type: 'stored', documentId: document.id })
  }

  logger.debug(
    { itemCount: items.length, savedCount: results.filter((r) => r.status === 'saved').length },
    '[ToolRegistry] save_documents',
  )

  return { output: JSON.stringify({ results }), events }
}

async function handleModifyDocuments(args: Record<string, unknown>): Promise<ToolExecutionResult> {
  const operations = requireArray(args, 'operations')
  const events: AgentEvent[] = []
  const results: ModifyOperationResult[] = []

  for (const raw of operations) {
    const operation = raw as Record<string, unknown>
    const documentId = requireString(operation, 'documentId')
    const action = requireString(operation, 'action')

    const existing = await getDocumentById(documentId)
    if (!existing) {
      results.push({ documentId, action, status: 'not_found' })
      continue
    }

    if (action === 'delete') {
      await hardDeleteDocument(documentId)
      events.push({ type: 'deleted', documentId })
      results.push({ documentId, action, status: 'success' })
    } else if (action === 'update') {
      const updatedContent = requireString(operation, 'updatedContent')
      const vector = await embedText(updatedContent)
      await updateDocument(documentId, { content: updatedContent, vector })
      results.push({ documentId, action, status: 'success' })
    } else {
      results.push({ documentId, action, status: 'not_found' })
    }
  }

  logger.debug(
    { operationCount: operations.length, successCount: results.filter((r) => r.status === 'success').length },
    '[ToolRegistry] modify_documents',
  )

  return { output: JSON.stringify({ results }), events }
}

// ── Tool definitions (JSON schemas for Ollama) ────────────────

const SEARCH_LIBRARY_TOOL: OllamaTool = {
  type: 'function',
  function: {
    name: 'search_library',
    description: 'Search the user\'s saved notes, todos, and documents by semantic similarity. Returns previews of matching documents.',
    parameters: {
      type: 'object',
      required: ['query'],
      properties: {
        query: {
          type: 'string',
          description: 'Semantic search query describing what to find',
        },
        type: {
          type: 'string',
          enum: ['thought', 'todo', 'note', 'meeting', 'instruction'],
          description: 'Optional filter by document type',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of results to return (default 10)',
        },
      },
    },
  },
}

const GET_DOCUMENT_TOOL: OllamaTool = {
  type: 'function',
  function: {
    name: 'get_document',
    description: 'Retrieve the full content of a specific document by its ID. Use after search_library to read a complete document.',
    parameters: {
      type: 'object',
      required: ['id'],
      properties: {
        id: {
          type: 'string',
          description: 'The document ID to retrieve',
        },
      },
    },
  },
}

const SAVE_DOCUMENTS_TOOL: OllamaTool = {
  type: 'function',
  function: {
    name: 'save_documents',
    description: 'Save one or more new documents to the user\'s library. Each item needs content, type, and tags. Tags on each item must reflect only that item\'s content (and type), not other items in the same batch. Returns the saved document IDs or duplicate warnings.',
    parameters: {
      type: 'object',
      required: ['items'],
      properties: {
        items: {
          type: 'array',
          description: 'Array of items to save',
          items: {
            type: 'object',
            required: ['content', 'type', 'tags'],
            properties: {
              content: {
                type: 'string',
                description: 'The exact text to store (preserve user wording)',
              },
              type: {
                type: 'string',
                enum: ['thought', 'todo', 'note', 'meeting', 'instruction'],
                description: 'Document type: todo for tasks/reminders, thought for ideas/notes, instruction for preferences',
              },
              tags: {
                type: 'array',
                items: { type: 'string' },
                description:
                  'Lowercase tags for retrieval for this item only. Derive from this item\'s content (and document type); do not copy tags from sibling items or the full user message.',
              },
              date: {
                type: 'string',
                description: 'ISO date string (defaults to today)',
              },
            },
          },
        },
      },
    },
  },
}

const MODIFY_DOCUMENTS_TOOL: OllamaTool = {
  type: 'function',
  function: {
    name: 'modify_documents',
    description: 'Update or delete existing documents by ID. Use search_library first to find the right document IDs.',
    parameters: {
      type: 'object',
      required: ['operations'],
      properties: {
        operations: {
          type: 'array',
          description: 'Array of modify/delete operations',
          items: {
            type: 'object',
            required: ['documentId', 'action'],
            properties: {
              documentId: {
                type: 'string',
                description: 'The ID of the document to modify',
              },
              action: {
                type: 'string',
                enum: ['update', 'delete'],
                description: 'Whether to update the content or delete the document',
              },
              updatedContent: {
                type: 'string',
                description: 'New content for the document (required when action is update)',
              },
            },
          },
        },
      },
    },
  },
}

// ── Registry ──────────────────────────────────────────────────

const TOOL_HANDLERS: ReadonlyMap<string, ToolHandler> = new Map([
  ['search_library', handleSearchLibrary],
  ['get_document', handleGetDocument],
  ['save_documents', handleSaveDocuments],
  ['modify_documents', handleModifyDocuments],
])

export function getToolDefinitions(): readonly OllamaTool[] {
  return [SEARCH_LIBRARY_TOOL, GET_DOCUMENT_TOOL, SAVE_DOCUMENTS_TOOL, MODIFY_DOCUMENTS_TOOL]
}

export async function executeTool(
  toolName: string,
  toolArguments: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const handler = TOOL_HANDLERS.get(toolName)
  if (!handler) {
    logger.warn({ toolName }, '[ToolRegistry] Unknown tool called')
    return {
      output: JSON.stringify({ error: `Unknown tool: ${toolName}` }),
      events: [],
    }
  }

  try {
    return await handler(toolArguments)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error({ toolName, error: message }, '[ToolRegistry] Tool execution failed')
    return {
      output: JSON.stringify({ error: message }),
      events: [],
    }
  }
}
