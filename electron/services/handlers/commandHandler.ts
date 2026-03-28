import { retrieveRelevantDocuments, retrieveTodoCandidatesForCommand } from '../documentPipeline'
import { hardDeleteDocument, getDocumentById, updateDocument } from '../lanceService'
import { embedText } from '../embeddingService'
import { resolveCommandTargets } from '../commandDecompositionService'
import { streamAssistantUserReplyWithFallback } from '../assistantReplyComposer'
import {
  clearPendingCommandClarification,
  getPendingCommandClarification,
  parseClarificationNumericReply,
  setPendingCommandClarification,
} from '../commandClarificationState'
import type { AssistantReplyFacts } from '../assistantReplyTypes'
import type {
  ClassificationForHandler,
  CommandResolution,
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
  classification: ClassificationForHandler,
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
    clearPendingCommandClarification()
    yield {
      type: 'turn_step_summary',
      summary: 'Command: no documents matched the search; nothing was modified.',
    }
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

  yield { type: 'status', message: 'Narrowing down exactly which notes to change…' }

  let resolution: CommandResolution
  const pending = getPendingCommandClarification()
  const numericSelection = parseClarificationNumericReply(userInput.trim())
  const commandIntentForPending: 'delete' | 'edit' | null =
    classification.intent === 'delete' || classification.intent === 'edit'
      ? classification.intent
      : null

  const resolvedFromPendingNumeric =
    pending !== null
    && commandIntentForPending !== null
    && pending.commandIntent === commandIntentForPending
    && numericSelection !== null
    && numericSelection >= 1
    && numericSelection <= pending.candidateDocumentIds.length

  if (resolvedFromPendingNumeric) {
    const chosenId = pending.candidateDocumentIds[numericSelection - 1]!
    const chosenFromBatch = documents.find((document) => document.id === chosenId)
    const chosenDocument = chosenFromBatch ?? (await getDocumentById(chosenId))
    if (chosenDocument !== null) {
      clearPendingCommandClarification()
      resolution = {
        status: 'execute',
        operations: [{
          targetDocumentIds: [chosenId],
          action: commandIntentForPending === 'delete' ? 'delete' : 'update',
          updatedContent: null,
          confidence: 0.99,
          description: `User selected option ${numericSelection} from the clarification list.`,
        }],
        clarificationMessage: null,
      }
    } else {
      clearPendingCommandClarification()
      try {
        resolution = await resolveCommandTargets(
          userInput,
          documents,
          conversationHistory,
          userInstructionsBlock,
          classification.intent === 'delete' || classification.intent === 'edit'
            ? classification.intent
            : undefined,
        )
      } catch {
        yield {
          type: 'turn_step_summary',
          summary: 'Command: decomposition failed; no documents were changed.',
        }
        yield {
          type: 'error',
          message: 'Failed to understand which documents to modify. Please try being more specific.',
        }
        yield { type: 'done' }
        return
      }
    }
  } else {
    try {
      resolution = await resolveCommandTargets(
        userInput,
        documents,
        conversationHistory,
        userInstructionsBlock,
        classification.intent === 'delete' || classification.intent === 'edit'
          ? classification.intent
          : undefined,
      )
    } catch {
      yield {
        type: 'turn_step_summary',
        summary: 'Command: decomposition failed; no documents were changed.',
      }
      yield {
        type: 'error',
        message: 'Failed to understand which documents to modify. Please try being more specific.',
      }
      yield { type: 'done' }
      return
    }
  }

  if (resolution.status === 'clarify') {
    const clarificationIds =
      resolution.clarificationCandidateDocumentIds
      ?? documents.map((document) => document.id)
    if (commandIntentForPending !== null) {
      setPendingCommandClarification({
        candidateDocumentIds: clarificationIds,
        commandIntent: commandIntentForPending,
        retrievalOptions: retrievalOpts,
      })
    }
    yield {
      type: 'turn_step_summary',
      summary: 'Command: targets were ambiguous; user was sent a clarification question. No edits or deletes ran.',
    }
    yield {
      type: 'chunk',
      content: resolution.clarificationMessage,
    }
    yield { type: 'done' }
    return
  }

  clearPendingCommandClarification()

  if (resolution.operations.length === 0) {
    yield {
      type: 'turn_step_summary',
      summary: 'Command: resolver returned no safe operations; nothing was modified.',
    }
    for await (const chunk of streamAssistantUserReplyWithFallback({
      userInstructionsBlock,
      facts: { kind: 'command_no_match' },
    })) {
      yield { type: 'chunk', content: chunk }
    }
    yield { type: 'done' }
    return
  }

  const executionStatusMessage =
    resolution.operations.length === 1
      ? resolution.operations[0].action === 'update'
        ? 'Updating your note…'
        : 'Removing that note…'
      : 'Applying your changes…'
  yield { type: 'status', message: executionStatusMessage }

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
  const deleteCount = results.reduce(
    (accumulator, result) => accumulator + (result.action === 'delete' ? result.documents.length : 0),
    0,
  )
  const updateCount = results.reduce(
    (accumulator, result) => accumulator + (result.action === 'update' ? result.documents.length : 0),
    0,
  )
  const summaryParts: string[] = ['Command: executed planned operations.']
  if (deleteCount > 0) {
    summaryParts.push(`Removed ${deleteCount} document(s).`)
  }
  if (updateCount > 0) {
    summaryParts.push(`Updated ${updateCount} document(s).`)
  }
  yield { type: 'turn_step_summary', summary: summaryParts.join(' ') }

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
