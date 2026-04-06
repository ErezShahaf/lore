import { retrieveRelevantDocuments, retrieveTodoCandidatesForCommand } from '../documentPipeline'
import { hardDeleteDocument, getDocumentById, updateDocument } from '../lanceService'
import { embedText } from '../embeddingService'
import {
  findUniquePendingCommandTargetFromText,
  resolveCommandTargets,
} from '../commandDecompositionService'
import { streamAssistantUserReplyWithFallback } from '../assistantReplyComposer'
import {
  clearPendingCommandClarification,
  getPendingCommandClarification,
  parseClarificationNumericReply,
  setPendingCommandClarification,
} from '../commandClarificationState'
import type { AssistantReplyFacts } from '../assistantReplyTypes'
import { resolveUiStatusMessage, UiStatusPhase } from '../uiStatusPhraseComposer'
import type {
  ClassificationForHandler,
  CommandResolution,
  ConversationEntry,
  AgentEvent,
  LoreDocument,
  CommandOperation,
  RetrievalOptions,
} from '../../../shared/types'

/** Emitted as `turn_step_summary` when delete/edit needs the user to pick among multiple matching documents. */
export const COMMAND_AMBIGUOUS_TARGETS_TURN_STEP_SUMMARY =
  'Command: targets were ambiguous; user was sent a clarification question. No edits or deletes ran.' as const

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
  yield {
    type: 'status',
    message: await resolveUiStatusMessage({
      request: { phase: UiStatusPhase.searchingLibraryForCommand },
      userInstructionsBlock,
    }),
  }

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
      reportedOutcomeStatus: 'failed',
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

  yield {
    type: 'status',
    message: await resolveUiStatusMessage({
      request: { phase: UiStatusPhase.narrowingCommandTargets },
      userInstructionsBlock,
    }),
  }

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
          reportedOutcomeStatus: 'failed',
        }
        for await (const chunk of streamAssistantUserReplyWithFallback({
          userInstructionsBlock,
          facts: { kind: 'command_resolution_failed' },
        })) {
          yield { type: 'chunk', content: chunk }
        }
        yield { type: 'done' }
        return
      }
    }
  } else {
    let resolutionFromPendingText: CommandResolution | null = null
    if (pending !== null && numericSelection === null && userInput.trim().length > 0) {
      const pendingDocuments = await loadPendingCandidateDocuments(
        pending.candidateDocumentIds,
        documents,
      )
      const uniqueTarget = findUniquePendingCommandTargetFromText(userInput, pendingDocuments)
      if (uniqueTarget !== null) {
        const classifierMatchesPending =
          commandIntentForPending !== null && pending.commandIntent === commandIntentForPending
        const classifierAssertsDifferentCommand =
          commandIntentForPending !== null && pending.commandIntent !== commandIntentForPending
        const bareLineConfirmsDeleteClarification =
          commandIntentForPending === null && pending.commandIntent === 'delete'
        const shouldResolvePendingLinePick =
          !classifierAssertsDifferentCommand
          && (classifierMatchesPending || bareLineConfirmsDeleteClarification)
        if (shouldResolvePendingLinePick) {
          clearPendingCommandClarification()
          resolutionFromPendingText = {
            status: 'execute',
            operations: [{
              targetDocumentIds: [uniqueTarget.id],
              action: pending.commandIntent === 'delete' ? 'delete' : 'update',
              updatedContent: null,
              confidence: 0.99,
              description: 'User matched one item from the clarification list by wording.',
            }],
            clarificationMessage: null,
          }
        }
      }
    }

    if (resolutionFromPendingText !== null) {
      resolution = resolutionFromPendingText
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
          reportedOutcomeStatus: 'failed',
        }
        for await (const chunk of streamAssistantUserReplyWithFallback({
          userInstructionsBlock,
          facts: { kind: 'command_resolution_failed' },
        })) {
          yield { type: 'chunk', content: chunk }
        }
        yield { type: 'done' }
        return
      }
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
      summary: COMMAND_AMBIGUOUS_TARGETS_TURN_STEP_SUMMARY,
      reportedOutcomeStatus: 'succeeded',
    }
    const presentation = resolution.clarifyPresentation
    if (presentation === undefined) {
      for await (const chunk of streamAssistantUserReplyWithFallback({
        userInstructionsBlock,
        facts: { kind: 'command_clarify_model_text', text: resolution.clarificationMessage },
      })) {
        yield { type: 'chunk', content: chunk }
      }
    } else if (presentation.style === 'template_numbered_options') {
      for await (const chunk of streamAssistantUserReplyWithFallback({
        userInstructionsBlock,
        facts: {
          kind: 'command_target_clarify',
          commandIntent: presentation.commandIntent,
          verbatimNumberedOptionsBlock: presentation.verbatimNumberedOptionsBlock,
        },
      })) {
        yield { type: 'chunk', content: chunk }
      }
    } else if (presentation.style === 'uncertain') {
      for await (const chunk of streamAssistantUserReplyWithFallback({
        userInstructionsBlock,
        facts: { kind: 'command_clarify_uncertain', hint: presentation.hint },
      })) {
        yield { type: 'chunk', content: chunk }
      }
    } else if (presentation.style === 'no_resolvable_targets') {
      for await (const chunk of streamAssistantUserReplyWithFallback({
        userInstructionsBlock,
        facts: { kind: 'command_resolution_failed' },
      })) {
        yield { type: 'chunk', content: chunk }
      }
    } else {
      for await (const chunk of streamAssistantUserReplyWithFallback({
        userInstructionsBlock,
        facts: { kind: 'command_clarify_model_text', text: presentation.text },
      })) {
        yield { type: 'chunk', content: chunk }
      }
    }
    yield { type: 'done' }
    return
  }

  clearPendingCommandClarification()

  if (resolution.operations.length === 0) {
    yield {
      type: 'turn_step_summary',
      summary: 'Command: resolver returned no safe operations; nothing was modified.',
      reportedOutcomeStatus: 'failed',
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

  const executionPhase =
    resolution.operations.length === 1
      ? resolution.operations[0].action === 'update'
        ? UiStatusPhase.commandExecutingUpdate
        : UiStatusPhase.commandExecutingDelete
      : UiStatusPhase.commandExecutingBatch
  yield {
    type: 'status',
    message: await resolveUiStatusMessage({
      request: {
        phase: executionPhase,
        matchingNoteCount: resolution.operations.length,
      },
      userInstructionsBlock,
    }),
  }

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
  yield {
    type: 'turn_step_summary',
    summary: summaryParts.join(' '),
    reportedOutcomeStatus: 'succeeded',
  }

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

async function loadPendingCandidateDocuments(
  ids: readonly string[],
  batch: readonly LoreDocument[],
): Promise<LoreDocument[]> {
  const batchById = new Map(batch.map((document) => [document.id, document]))
  const result: LoreDocument[] = []
  for (const id of ids) {
    const fromBatch = batchById.get(id)
    if (fromBatch !== undefined) {
      result.push(fromBatch)
      continue
    }
    const fetched = await getDocumentById(id)
    if (fetched !== null) {
      result.push(fetched)
    }
  }
  return result
}
