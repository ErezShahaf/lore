import { retrieveRelevantDocuments } from '../documentPipeline'
import { hardDeleteDocument, updateDocument } from '../lanceService'
import { embedText } from '../embeddingService'
import { resolveCommandTargets } from '../commandDecompositionService'
import type {
  ClassificationResult,
  ConversationEntry,
  AgentEvent,
  LoreDocument,
  CommandOperation,
} from '../../../shared/types'

interface ExecutionResult {
  action: CommandOperation['action']
  documents: LoreDocument[]
}

export async function* handleCommand(
  userInput: string,
  classification: ClassificationResult,
  conversationHistory: readonly ConversationEntry[] = [],
): AsyncGenerator<AgentEvent> {
  yield { type: 'status', message: 'Finding relevant documents...' }

  const isTodoCompletion = classification.extractedTags.some(
    (tag) => tag.toLowerCase() === 'todo',
  )
  const retrievalOpts = isTodoCompletion
    ? { type: 'todo' as const }
    : undefined
  const documents = await retrieveRelevantDocuments(userInput, retrievalOpts)

  if (documents.length === 0) {
    yield {
      type: 'chunk',
      content: "I couldn't find any documents matching your request. Could you be more specific?",
    }
    yield { type: 'done' }
    return
  }

  yield { type: 'status', message: 'Analyzing your request...' }

  let resolution
  try {
    resolution = await resolveCommandTargets(userInput, documents, conversationHistory)
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
    yield {
      type: 'chunk',
      content: "I couldn't match your request to any stored documents.",
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
    results.push({ action: operation.action, documents: affected })
  }

  yield { type: 'chunk', content: buildConfirmationMessage(results) }
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

function buildConfirmationMessage(results: ExecutionResult[]): string {
  if (results.length === 0) return 'No changes were made.'

  const deletedDocuments = results.filter((result) => result.action === 'delete').flatMap((result) => result.documents)
  const updatedDocuments = results.filter((result) => result.action === 'update').flatMap((result) => result.documents)

  const parts: string[] = []

  if (deletedDocuments.length > 0) {
    parts.push(formatDeletedSummary(deletedDocuments))
  }

  if (updatedDocuments.length > 0) {
    parts.push(formatUpdatedSummary(updatedDocuments))
  }

  return `Done! I've ${parts.join(', and ')}.`
}

function formatDeletedSummary(documents: LoreDocument[]): string {
  if (documents.length <= 3) {
    const previews = documents.map((document) => `"${truncateContent(document.content, 60)}"`)
    return `removed ${previews.join(' and ')}`
  }
  return `removed ${documents.length} documents`
}

function formatUpdatedSummary(documents: LoreDocument[]): string {
  if (documents.length === 1) {
    return `updated "${truncateContent(documents[0].content, 60)}"`
  }
  return `updated ${documents.length} documents`
}

function truncateContent(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength) + '...'
}
