import { storeThought, checkForDuplicate } from '../documentPipeline'
import { updateDocument } from '../lanceService'
import { embedText } from '../embeddingService'
import { formatLocalDate } from '../localDate'
import { streamAssistantUserReplyWithFallback } from '../assistantReplyComposer'
import { resolveDuplicateIntent } from '../duplicateResolutionService'
import { logger } from '../../logger'
import type {
  ClassificationForHandler,
  AgentEvent,
  DecomposedDocumentType,
  DocumentType,
  ConversationEntry,
} from '../../../shared/types'

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
): AsyncGenerator<AgentEvent> {
  const trimmed = userInput.trim()
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

  const today = formatLocalDate(new Date())
  const date = classification.extractedDate ?? today
  const documentType = classification.saveDocumentType ?? 'thought'
  const tags = tagsForSaveDocument(documentType, classification.extractedTags)

  yield* storeSingleItem(
    trimmed,
    trimmed,
    documentType,
    date,
    tags,
    null,
    userInstructionsBlock,
    conversationHistory,
  )

  yield { type: 'done' }
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
): AsyncGenerator<AgentEvent> {
  yield {
    type: 'status',
    message: 'Checking whether you already saved something very similar…',
  }
  const duplicate = await checkForDuplicate(content)

  if (duplicate) {
    const resolution = await resolveDuplicateIntent(originalInput, conversationHistory, userInstructionsBlock)
    if (resolution === 'ask') {
      const preview = duplicate.content.slice(0, 120)
      yield { type: 'duplicate', existingContent: preview }
      yield {
        type: 'turn_step_summary',
        summary:
          'Save: duplicate check found very similar existing note; user was asked to reply with add new or update. No new document was written.',
      }
      yield {
        type: 'chunk',
        content:
          'You already have a similar note. Reply with "add new" to save it separately, or "update" to replace the existing one.',
      }
      return
    }
    if (resolution === 'update') {
      yield { type: 'status', message: 'Updating your existing note…' }
      const vector = await embedText(content)
      await updateDocument(duplicate.id, { content, vector })
      yield { type: 'stored', documentId: duplicate.id }
      const preview = content.slice(0, 60) + (content.length > 60 ? '...' : '')
      yield {
        type: 'turn_step_summary',
        summary: `Save: updated existing similar document in place (id ${duplicate.id}).`,
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
    },
  })) {
    yield { type: 'chunk', content: chunk }
  }
}

function summarizeTopic(input: string): string {
  const words = input.split(/\s+/).slice(0, 6).join(' ')
  return words.length < input.length ? `${words}...` : words
}
