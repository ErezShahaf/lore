import { retrieveRelevantDocuments, retrieveTodoCandidatesForCommand } from '../documentPipeline'
import { hardDeleteDocument, updateDocument } from '../lanceService'
import { embedText } from '../embeddingService'
import { resolveCommandTargets } from '../commandDecompositionService'
import { streamAssistantUserReplyWithFallback } from '../assistantReplyComposer'
import type { AssistantReplyFacts } from '../assistantReplyTypes'
import type {
  ClassificationResult,
  ConversationEntry,
  AgentEvent,
  LoreDocument,
  CommandOperation,
  RetrievalOptions,
} from '../../../shared/types'

interface ExecutionResult {
  action: CommandOperation['action']
  documents: LoreDocument[]
  updatedContent: string | null
}

export async function* handleCommand(
  userInput: string,
  classification: ClassificationResult,
  conversationHistory: readonly ConversationEntry[] = [],
  retrievalOverrides?: RetrievalOptions,
  userInstructionsBlock: string = '',
): AsyncGenerator<AgentEvent> {
  yield { type: 'status', message: 'Searching your library for matching documents…' }

  const isTodoCompletion = classification.extractedTags.some(
    (tag) => tag.toLowerCase() === 'todo',
  )
  const retrievalOpts: RetrievalOptions = { ...retrievalOverrides }

  if (!retrievalOpts.type && isTodoCompletion) {
    retrievalOpts.type = 'todo'
  }

  const documents =
    retrievalOpts.type === 'todo'
      ? await retrieveTodoCandidatesForCommand(retrievalOpts)
      : await retrieveRelevantDocuments(userInput, retrievalOpts)

  if (documents.length === 0) {
    for await (const chunk of streamAssistantUserReplyWithFallback({
      userInstructionsBlock,
      facts: { kind: 'command_no_documents' },
    })) {
      yield { type: 'chunk', content: chunk }
    }
    yield { type: 'done' }
    return
  }

  yield {
    type: 'retrieved',
    documentIds: documents.map((document) => document.id),
    totalRetrieved: documents.length,
  }

  yield { type: 'status', message: 'Resolving which documents to change (command agent)…' }

  let resolution
  try {
    resolution = await resolveCommandTargets(userInput, documents, conversationHistory, userInstructionsBlock)
  } catch {
    yield {
      type: 'error',
      message: 'Failed to understand which documents to modify. Please try being more specific.',
    }
    yield { type: 'done' }
    return
  }

  if (resolution.status === 'clarify') {
    yield {
      type: 'chunk',
      content: resolution.clarificationMessage,
    }
    yield { type: 'done' }
    return
  }

  if (resolution.operations.length === 0) {
    for await (const chunk of streamAssistantUserReplyWithFallback({
      userInstructionsBlock,
      facts: { kind: 'command_no_match' },
    })) {
      yield { type: 'chunk', content: chunk }
    }
    yield { type: 'done' }
    return
  }

  const operationLabel = resolution.operations.length === 1
    ? resolution.operations[0].action
    : `${resolution.operations.length} operations`
  yield { type: 'status', message: `Executing ${operationLabel}...` }

  const documentLookup = new Map(documents.map((document) => [document.id, document]))
  const results: ExecutionResult[] = []

  for (const operation of resolution.operations) {
    const affected = operation.targetDocumentIds
      .map((id) => documentLookup.get(id))
      .filter((document): document is LoreDocument => document !== undefined)

    if (affected.length === 0) continue

    yield* executeOperation(operation, affected)
    results.push({
      action: operation.action,
      documents: affected,
      updatedContent: operation.updatedContent,
    })
  }

  const executedFacts = buildCommandExecutedFacts(results)
  for await (const chunk of streamAssistantUserReplyWithFallback({
    userInstructionsBlock,
    facts: executedFacts,
  })) {
    yield { type: 'chunk', content: chunk }
  }
  yield { type: 'done' }
}

async function* executeOperation(
  operation: CommandOperation,
  affected: LoreDocument[],
): AsyncGenerator<AgentEvent> {
  switch (operation.action) {
    case 'delete':
      for (const document of affected) {
        await hardDeleteDocument(document.id)
        yield { type: 'deleted', documentId: document.id }
      }
      break

    case 'update':
      for (const document of affected) {
        const updates: Partial<LoreDocument> = {}
        if (operation.updatedContent) {
          updates.content = operation.updatedContent
          updates.vector = await embedText(operation.updatedContent)
        }
        await updateDocument(document.id, updates)
      }
      break
  }
}

function buildCommandExecutedFacts(results: ExecutionResult[]): AssistantReplyFacts {
  const operations: Array<{ readonly action: 'delete' | 'update'; readonly contentPreview: string }> = []

  for (const result of results) {
    for (const document of result.documents) {
      const preview =
        result.action === 'update' && result.updatedContent
          ? result.updatedContent
          : document.content
      operations.push({
        action: result.action,
        contentPreview: truncateContent(preview, 60),
      })
    }
  }

  return { kind: 'command_executed', operations }
}

function truncateContent(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength) + '...'
}
