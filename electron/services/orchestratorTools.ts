import { logger } from '../logger'
import { classifyInput } from './classifierService'
import { composeAssistantUserReplyText } from './assistantReplyComposer'
import type { AssistantReplyFacts } from './assistantReplyTypes'
import {
  multiQueryRetrieve,
  retrieveByFilters,
  retrieveRelevantDocuments,
  retrieveTodoCandidatesForCommand,
  retrieveWithAdaptiveThreshold,
} from './documentPipeline'
import {
  getToolDefinitions as getBaseToolDefinitions,
  executeTool as executeBaseTool,
  type ToolExecutionResult,
} from './toolRegistry'
import {
  primaryClassificationAction,
  type AgentEvent,
  type ClassificationResult,
  type ConversationEntry,
  type DocumentType,
  type InputClassification,
  type OllamaTool,
  type RetrievalOptions,
  type ScoredDocument,
} from '../../shared/types'

// ── Tool execution context ────────────────────────────────────

export interface OrchestratorToolContext {
  readonly userInput: string
  readonly priorHistory: readonly ConversationEntry[]
  readonly userInstructionsBlock: string
  /** Cache of documents by id to avoid re-fetching after search. Populated by search_for_question and search_for_command. */
  readonly documentsCache: Map<string, ScoredDocument>
}

// ── Helpers ───────────────────────────────────────────────────

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') return undefined
  return value.trim() || undefined
}

function optionalObject<T>(args: Record<string, unknown>, key: string): T | undefined {
  const value = args[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as T
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Missing or empty required string parameter: ${key}`)
  }
  return value.trim()
}

function parseClassificationFromArgs(
  args: Record<string, unknown>,
): ClassificationResult | undefined {
  const raw = optionalObject<Record<string, unknown>>(args, 'classification')
  if (!raw || typeof raw.intent !== 'string') return undefined

  const intent = raw.intent as InputClassification
  if (!['read', 'save', 'edit', 'delete', 'speak'].includes(intent)) {
    return undefined
  }

  const extractedDate = typeof raw.extractedDate === 'string' ? raw.extractedDate : null
  const extractedTags = Array.isArray(raw.extractedTags)
    ? (raw.extractedTags as unknown[]).filter((tag): tag is string => typeof tag === 'string')
    : []
  const situationSummary = typeof raw.situationSummary === 'string' ? raw.situationSummary : ''
  const data = typeof raw.data === 'string' ? raw.data : ''

  return {
    actions: [
      {
        intent,
        extractedDate,
        extractedTags,
        situationSummary,
        data,
        saveDocumentType: intent === 'save' ? 'thought' : null,
      },
    ],
  }
}

// ── compose_reply ─────────────────────────────────────────────

async function handleComposeReply(
  args: Record<string, unknown>,
  context: OrchestratorToolContext,
): Promise<ToolExecutionResult> {
  const factKind = requireString(args, 'factKind')
  const payloadRaw = optionalObject<Record<string, unknown>>(args, 'payload') ?? {}

  let facts: AssistantReplyFacts
  switch (factKind) {
    case 'thought_saved_single':
      facts = {
        kind: 'thought_saved_single',
        documentType: (payloadRaw.documentType as DocumentType) ?? 'thought',
        topicSummary: String(payloadRaw.topicSummary ?? ''),
        hadDuplicate: Boolean(payloadRaw.hadDuplicate),
        duplicatePreview: typeof payloadRaw.duplicatePreview === 'string' ? payloadRaw.duplicatePreview : null,
        storedContentPreview: typeof payloadRaw.storedContentPreview === 'string'
          ? payloadRaw.storedContentPreview
          : null,
      }
      break
    case 'thought_saved_many':
      facts = {
        kind: 'thought_saved_many',
        itemCount: Number(payloadRaw.itemCount) || 0,
        todoItemCount: Number(payloadRaw.todoItemCount) || 0,
        hasTodos: Boolean(payloadRaw.hasTodos),
        duplicateCount: Number(payloadRaw.duplicateCount) || 0,
      }
      break
    case 'instruction_stored':
      facts = {
        kind: 'instruction_stored',
        similarInstructionPreviews: Array.isArray(payloadRaw.similarInstructionPreviews)
          ? (payloadRaw.similarInstructionPreviews as string[])
          : [],
      }
      break
    case 'command_no_documents':
      facts = { kind: 'command_no_documents' }
      break
    case 'command_no_match':
      facts = { kind: 'command_no_match' }
      break
    case 'command_executed':
      facts = {
        kind: 'command_executed',
        operations: Array.isArray(payloadRaw.operations)
          ? (payloadRaw.operations as Array<{ action: 'delete' | 'update'; contentPreview: string }>)
          : [],
      }
      break
    case 'duplicate_save_clarification_pending': {
      const fromArray = Array.isArray(payloadRaw.existingSimilarContents)
        ? (payloadRaw.existingSimilarContents as unknown[]).filter(
            (item): item is string => typeof item === 'string',
          )
        : []
      const legacySingle =
        typeof payloadRaw.existingNoteContent === 'string'
          && payloadRaw.existingNoteContent.trim().length > 0
          ? [payloadRaw.existingNoteContent]
          : []
      const existingSimilarContents = fromArray.length > 0 ? fromArray : legacySingle
      facts = {
        kind: 'duplicate_save_clarification_pending',
        documentType: (payloadRaw.documentType as DocumentType) ?? 'thought',
        existingSimilarContents,
        pendingNewContent: String(payloadRaw.pendingNewContent ?? ''),
      }
      break
    }
    default:
      facts = { kind: 'command_executed', operations: [] }
  }

  const reply = await composeAssistantUserReplyText({
    facts,
    userInstructionsBlock: context.userInstructionsBlock,
  })
  return { output: reply, events: [{ type: 'chunk', content: reply }] }
}

// ── search_for_question ───────────────────────────────────────

async function handleSearchForQuestion(
  args: Record<string, unknown>,
  context: OrchestratorToolContext,
): Promise<ToolExecutionResult> {
  let classification = parseClassificationFromArgs(args)
  if (!classification) {
    classification = await classifyInput(
      context.userInput,
      context.priorHistory,
      context.userInstructionsBlock,
    )
  }
  const primary = primaryClassificationAction(classification)
  const query = optionalString(args, 'query') ?? context.userInput
  const typeFilter = optionalString(args, 'type') as DocumentType | undefined
  const maxResults = typeof args.maxResults === 'number' ? args.maxResults : 8

  const retrievalOpts: RetrievalOptions = { maxResults }
  if (primary.extractedTags.length > 0) {
    retrievalOpts.tags = primary.extractedTags
  }
  if (primary.extractedDate) {
    retrievalOpts.dateFrom = primary.extractedDate
    retrievalOpts.dateTo = primary.extractedDate
  }
  if (typeFilter) {
    retrievalOpts.type = typeFilter
  }

  const isTodoQuery = typeFilter === 'todo' || primary.extractedTags.some((tag) => tag === 'todo')
  let result: { documents: ScoredDocument[]; totalCandidates: number; cutoffScore: number }

  if (isTodoQuery) {
    const todoResult = await retrieveByFilters({
      ...retrievalOpts,
      type: 'todo',
      maxResults: 50,
    })
    const sorted = [...todoResult.documents].sort((a, b) => {
      const cmp = (b.date ?? '').localeCompare(a.date ?? '')
      return cmp !== 0 ? cmp : b.createdAt.localeCompare(a.createdAt)
    })
    result = {
      documents: sorted.slice(0, maxResults),
      totalCandidates: todoResult.totalCandidates,
      cutoffScore: todoResult.cutoffScore,
    }
  } else {
    result = await retrieveWithAdaptiveThreshold(query, retrievalOpts)
    if (result.documents.length === 0) {
      const fallbackQueries = [
        query,
        ...primary.extractedTags.filter((tag) => tag.length >= 4),
      ]
      const unique = [...new Set(fallbackQueries.map((q) => q.trim()).filter(Boolean))]
      const fallback = await multiQueryRetrieve(unique, retrievalOpts)
      result = fallback
    }
  }

  const fullDocuments = result.documents.slice(0, maxResults)
  for (const doc of fullDocuments) {
    context.documentsCache.set(doc.id, doc)
  }

  const documents = fullDocuments.map((d) => ({
    id: d.id,
    type: d.type,
    date: d.date,
    tags: d.tags ? d.tags.split(',').filter(Boolean) : [],
    content: d.content,
    score: d.score,
  }))

  const output = JSON.stringify({
    documents,
    totalFound: result.totalCandidates,
    documentIds: documents.map((d) => d.id),
  })

  const events: AgentEvent[] =
    documents.length > 0
      ? [
          {
            type: 'retrieved',
            documentIds: documents.map((d) => d.id),
            totalRetrieved: documents.length,
            totalCandidates: result.totalCandidates,
          },
        ]
      : []

  return { output, events }
}

// ── search_for_command ────────────────────────────────────────

async function handleSearchForCommand(
  args: Record<string, unknown>,
  context: OrchestratorToolContext,
): Promise<ToolExecutionResult> {
  let classification = parseClassificationFromArgs(args)
  if (!classification) {
    classification = await classifyInput(
      context.userInput,
      context.priorHistory,
      context.userInstructionsBlock,
    )
  }
  const primary = primaryClassificationAction(classification)
  const typeFilter = optionalString(args, 'type') as DocumentType | undefined

  const retrievalOpts: RetrievalOptions = { maxResults: 50 }
  const isTodoCompletion = primary.extractedTags.some((tag) => tag.toLowerCase() === 'todo')
  if (typeFilter || isTodoCompletion) {
    retrievalOpts.type = typeFilter ?? 'todo'
  }

  const documents =
    retrievalOpts.type === 'todo'
      ? await retrieveTodoCandidatesForCommand(retrievalOpts)
      : await retrieveRelevantDocuments(context.userInput, retrievalOpts)

  for (const doc of documents) {
    context.documentsCache.set(doc.id, { ...doc, score: 1 })
  }

  const output = JSON.stringify({
    documentIds: documents.map((d) => d.id),
    documents: documents.map((d) => ({
      id: d.id,
      type: d.type,
      date: d.date,
      content: d.content,
    })),
  })

  const events: AgentEvent[] =
    documents.length > 0
      ? [{ type: 'retrieved', documentIds: documents.map((d) => d.id), totalRetrieved: documents.length }]
      : []

  return { output, events }
}

// ── Tool definitions and registry ──────────────────────────────

const COMPOSE_REPLY_TOOL: OllamaTool = {
  type: 'function',
  function: {
    name: 'compose_reply',
    description:
      'Compose a confirmation or response message. Input: factKind (thought_saved_single, duplicate_save_clarification_pending, thought_saved_many, instruction_stored, command_no_documents, command_no_match, command_executed), payload (object with fields for that kind).',
    parameters: {
      type: 'object',
      required: ['factKind', 'payload'],
      properties: {
        factKind: { type: 'string' },
        payload: { type: 'object' },
      },
    },
  },
}

const SEARCH_FOR_QUESTION_TOOL: OllamaTool = {
  type: 'function',
  function: {
    name: 'search_for_question',
    description:
      'Search the library for a question. Provide classification in params. Optional: query, type, maxResults. Returns documents (id, type, content) and documentIds.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        type: { type: 'string', enum: ['thought', 'todo', 'note', 'meeting', 'instruction'] },
        maxResults: { type: 'number' },
        classification: { type: 'object' },
      },
    },
  },
}

const SEARCH_FOR_COMMAND_TOOL: OllamaTool = {
  type: 'function',
  function: {
    name: 'search_for_command',
    description:
      'Search the library for command targets (documents to modify/delete). Provide classification in params. Optional: type. Returns documents (id, type, content) and documentIds.',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['thought', 'todo', 'note', 'meeting', 'instruction'] },
        classification: { type: 'object' },
      },
    },
  },
}

type OrchestratorToolHandler = (
  args: Record<string, unknown>,
  context: OrchestratorToolContext,
) => Promise<ToolExecutionResult>

const ORCHESTRATOR_HANDLERS: ReadonlyMap<string, OrchestratorToolHandler> = new Map([
  ['compose_reply', handleComposeReply],
  ['search_for_question', handleSearchForQuestion],
  ['search_for_command', handleSearchForCommand],
])

export function getOrchestratorAgentNames(): readonly string[] {
  const baseNames = getBaseToolDefinitions().map((t) => t.function.name)
  const orchestratorNames = [...ORCHESTRATOR_HANDLERS.keys()]
  return [...new Set([...baseNames, ...orchestratorNames])]
}

export function getOrchestratorToolDefinitions(): readonly OllamaTool[] {
  const base = getBaseToolDefinitions()
  const orchestratorTools: OllamaTool[] = [
    SEARCH_FOR_QUESTION_TOOL,
    SEARCH_FOR_COMMAND_TOOL,
    COMPOSE_REPLY_TOOL,
  ]
  return [...base, ...orchestratorTools]
}

export async function executeOrchestratorTool(
  toolName: string,
  toolArguments: Record<string, unknown>,
  context: OrchestratorToolContext,
): Promise<ToolExecutionResult> {
  const handler = ORCHESTRATOR_HANDLERS.get(toolName)
  if (handler) {
    try {
      return await handler(toolArguments, context)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error({ toolName, error: message }, '[OrchestratorTools] Tool failed')
      return {
        output: JSON.stringify({ error: message }),
        events: [],
      }
    }
  }

  return executeBaseTool(toolName, toolArguments)
}
