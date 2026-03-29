import { storeThought, findSimilarDocumentsForSave } from '../documentPipeline'
import { updateDocument } from '../lanceService'
import { embedText } from '../embeddingService'
import { formatLocalDate } from '../localDate'
import { streamAssistantUserReplyWithFallback } from '../assistantReplyComposer'
import { resolveDuplicatePromptFollowUp } from '../duplicatePromptFollowUpService'
import {
  clearPendingDuplicateSaveClarification,
  getPendingDuplicateSaveClarification,
  setPendingDuplicateSaveClarification,
} from '../duplicateSaveClarificationState'
import { resolveSaveNoteBody } from '../saveNoteBodyResolutionService'
import { logger } from '../../logger'
import type {
  ClassificationForHandler,
  AgentEvent,
  DecomposedDocumentType,
  DocumentType,
  ConversationEntry,
} from '../../../shared/types'

export interface HandleThoughtOptions {
  /**
   * When the classifier split this turn into several actions, each save step receives only
   * that step's payload in `userInput`. Body-resolution must not merge the full turn back in.
   */
  readonly totalActionsInTurn?: number
}

function normalizeTodoBodyForStorage(raw: string): string {
  let text = raw.trim()
  const commandPrefixes = [
    /^add to my todo(?: list)?:\s*/i,
    /^add to (?:my )?(?:todo )?list:\s*/i,
    /^add to my todos?:\s*/i,
    /^todo:\s*/i,
    /^remind me(?: to)?:\s*/i,
  ] as const
  for (const pattern of commandPrefixes) {
    text = text.replace(pattern, '')
  }
  return text.trim()
}

function tagsForSaveDocument(
  documentType: DecomposedDocumentType,
  extractedTags: readonly string[],
): string[] {
  const lowerTags = extractedTags.map((tag) => tag.toLowerCase())
  const typeTag = documentType !== 'thought' ? documentType : null
  const tags =
    typeTag && !lowerTags.includes(typeTag)
      ? [typeTag, ...extractedTags]
      : [...extractedTags]
  return [...new Set(tags.map((tag) => tag.toLowerCase()))].filter(Boolean)
}

export async function* handleThought(
  userInput: string,
  classification: ClassificationForHandler,
  conversationHistory: readonly ConversationEntry[] = [],
  userInstructionsBlock: string = '',
  fullTurnUserMessage?: string,
  options: HandleThoughtOptions = {},
): AsyncGenerator<AgentEvent> {
  const trimmed = userInput.trim()
  const fullTurn = (fullTurnUserMessage ?? userInput).trim()
  const isMultiActionTurn =
    options.totalActionsInTurn !== undefined && options.totalActionsInTurn > 1

  if (trimmed.length === 0) {
    logger.warn({ userInput }, '[ThoughtHandler] Empty save input')
    yield {
      type: 'turn_step_summary',
      summary: 'Save: input was empty; nothing was stored.',
    }
    yield { type: 'chunk', content: 'Nothing to save.' }
    yield { type: 'done' }
    return
  }

  const pendingDuplicate = getPendingDuplicateSaveClarification()
  if (pendingDuplicate !== null) {
    const followUp = await resolveDuplicatePromptFollowUp({
      userMessage: trimmed,
      conversationHistory,
      userInstructionsBlock,
      pendingContentPreview: pendingDuplicate.contentToStore,
      pendingDocumentType: pendingDuplicate.documentType,
    })
    if (followUp === 'add_second_copy') {
      clearPendingDuplicateSaveClarification()
      yield* storeSingleItem(
        pendingDuplicate.contentToStore,
        pendingDuplicate.originalInputForSource,
        pendingDuplicate.documentType,
        pendingDuplicate.date,
        [...pendingDuplicate.tags],
        null,
        userInstructionsBlock,
        conversationHistory,
        { skipDuplicateCheck: true },
      )
      yield { type: 'done' }
      return
    }
    if (followUp === 'replace_existing') {
      clearPendingDuplicateSaveClarification()
      const replaceTargetId = pendingDuplicate.duplicateDocumentIds[0]
      if (replaceTargetId === undefined) {
        yield { type: 'chunk', content: 'Nothing to update.' }
        yield { type: 'done' }
        return
      }
      yield* emitThoughtUpdateAfterDuplicateChoice(
        replaceTargetId,
        pendingDuplicate.contentToStore,
        userInstructionsBlock,
      )
      yield { type: 'done' }
      return
    }
    clearPendingDuplicateSaveClarification()
  }

  let resolvedContent = trimmed
  const documentTypeForResolution = classification.saveDocumentType ?? 'thought'
  const skipStructuredBodyResolution = documentTypeForResolution === 'instruction'

  if (isMultiActionTurn) {
    if (resolvedContent.length === 0) {
      logger.warn({ userInput, fullTurn }, '[ThoughtHandler] Multi-action save had empty payload')
      yield {
        type: 'turn_step_summary',
        summary: 'Save: multi-action step had empty payload; nothing was stored.',
      }
      yield { type: 'chunk', content: 'Nothing to save for this step.' }
      yield { type: 'done' }
      return
    }
  } else if (!skipStructuredBodyResolution) {
    const bodyResolution = await resolveSaveNoteBody({
      handlerPayload: trimmed,
      fullTurnUserMessage: fullTurn,
      conversationHistory,
      routerSituationSummary: classification.situationSummary,
      userInstructionsBlock,
    })

    if (bodyResolution.step === 'clarify_intent') {
      yield {
        type: 'turn_step_summary',
        summary:
          'Save: model chose intent clarification; nothing was stored until the user is clearer.',
      }
      yield {
        type: 'chunk',
        content:
          'You sent structured data without saying what to do with it. Should I save it as a note, help you find something in your library, or answer a question about it?',
      }
      yield { type: 'done' }
      return
    }

    if (bodyResolution.step === 'ask_short_title') {
      yield {
        type: 'turn_step_summary',
        summary:
          'Save: model asked for a short title or description before writing structured data.',
      }
    yield {
      type: 'chunk',
      content:
        'Before I save it, what should I call this, or do you want a one-line description? That makes it easier to find later—I can use it in the title or tags.',
    }
      yield { type: 'done' }
      return
    }

    resolvedContent = bodyResolution.noteBody.trim()
  }

  if (documentTypeForResolution === 'todo') {
    resolvedContent = normalizeTodoBodyForStorage(resolvedContent)
  }

  if (resolvedContent.length === 0) {
    logger.warn({ userInput, fullTurn }, '[ThoughtHandler] Resolved save body was empty')
    yield {
      type: 'turn_step_summary',
      summary: 'Save: resolved note body was empty; nothing was stored.',
    }
    yield { type: 'chunk', content: 'Nothing to save.' }
    yield { type: 'done' }
    return
  }

  const today = formatLocalDate(new Date())
  const date = classification.extractedDate ?? today
  const documentType = documentTypeForResolution
  const tags = tagsForSaveDocument(documentType, classification.extractedTags)

  yield* storeSingleItem(
    resolvedContent,
    resolvedContent,
    documentType,
    date,
    tags,
    null,
    userInstructionsBlock,
    conversationHistory,
  )

  yield { type: 'done' }
}

interface StoreSingleItemOptions {
  readonly skipDuplicateCheck?: boolean
}

async function* emitThoughtUpdateAfterDuplicateChoice(
  documentId: string,
  content: string,
  userInstructionsBlock: string,
): AsyncGenerator<AgentEvent> {
  yield { type: 'status', message: 'Updating your existing note…' }
  const vector = await embedText(content)
  await updateDocument(documentId, { content, vector })
  yield { type: 'stored', documentId }
  const preview = content.slice(0, 60) + (content.length > 60 ? '...' : '')
  yield {
    type: 'turn_step_summary',
    summary: `Save: updated existing similar document in place (id ${documentId}).`,
  }
  for await (const chunk of streamAssistantUserReplyWithFallback({
    userInstructionsBlock,
    facts: {
      kind: 'command_executed',
      operations: [{ action: 'update', contentPreview: preview }],
    },
  })) {
    yield { type: 'chunk', content: chunk }
  }
}

async function* storeSingleItem(
  content: string,
  originalInput: string,
  docType: DocumentType,
  date: string,
  tags: readonly string[],
  customSavedJsonMessage: string | null,
  userInstructionsBlock: string,
  conversationHistory: readonly ConversationEntry[] = [],
  options: StoreSingleItemOptions = {},
): AsyncGenerator<AgentEvent> {
  if (!options.skipDuplicateCheck) {
    yield {
      type: 'status',
      message: 'Checking for an existing duplicate…',
    }
    const similarDocuments = await findSimilarDocumentsForSave(content, {
      documentType: docType,
      userInstructionsBlock,
    })

    if (similarDocuments.length > 0) {
      setPendingDuplicateSaveClarification({
        contentToStore: content,
        originalInputForSource: originalInput,
        documentType: docType,
        date,
        tags: [...tags],
        duplicateDocumentIds: similarDocuments.map((document) => document.id),
      })
      const previewSource = similarDocuments[0]?.content ?? ''
      const preview = previewSource.slice(0, 120)
      yield { type: 'duplicate', existingContent: preview }
      yield {
        type: 'turn_step_summary',
        summary:
          'Save: similar items already in the library; waiting for user to confirm a new copy or replace. No new document was written.',
      }
      for await (const chunk of streamAssistantUserReplyWithFallback({
        userInstructionsBlock,
        facts: {
          kind: 'duplicate_save_clarification_pending',
          documentType: docType,
          existingSimilarContents: similarDocuments.map((document) => document.content),
          pendingNewContent: content,
        },
      })) {
        yield { type: 'chunk', content: chunk }
      }
      return
    }
  }

  yield { type: 'status', message: 'Saving to your library…' }
  const doc = await storeThought({
    content,
    originalInput,
    type: docType,
    date,
    tags,
  })

  yield { type: 'stored', documentId: doc.id }

  if (customSavedJsonMessage) {
    yield {
      type: 'turn_step_summary',
      summary: `Save: stored new ${docType} (id ${doc.id}).`,
    }
    yield { type: 'chunk', content: customSavedJsonMessage }
    return
  }

  yield {
    type: 'turn_step_summary',
    summary: `Save: stored new ${docType} (id ${doc.id}).`,
  }

  const topic = summarizeTopic(content)
  for await (const chunk of streamAssistantUserReplyWithFallback({
    userInstructionsBlock,
    facts: {
      kind: 'thought_saved_single',
      documentType: docType,
      topicSummary: topic,
      hadDuplicate: false,
      duplicatePreview: null,
      storedContentPreview: buildStoredContentPreviewForReply(content),
    },
  })) {
    yield { type: 'chunk', content: chunk }
  }
}

const STORED_CONTENT_PREVIEW_MAX_CHARS = 480

function buildStoredContentPreviewForReply(rawContent: string): string | null {
  const trimmed = rawContent.trim()
  if (trimmed.length === 0) {
    return null
  }
  if (trimmed.length <= STORED_CONTENT_PREVIEW_MAX_CHARS) {
    return trimmed
  }
  return `${trimmed.slice(0, STORED_CONTENT_PREVIEW_MAX_CHARS)}…`
}

function summarizeTopic(input: string): string {
  const words = input.split(/\s+/).slice(0, 6).join(' ')
  return words.length < input.length ? `${words}...` : words
}
