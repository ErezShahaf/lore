import { v4 as uuidv4 } from 'uuid'
import { storeThought, storeThoughtWithMetadata, checkForDuplicate } from '../documentPipeline'
import { updateDocument } from '../lanceService'
import { embedText } from '../embeddingService'
import { formatLocalDate } from '../localDate'
import { decomposeForStorage } from '../saveDecompositionService'
import { planSaveShape } from '../saveShapeService'
import { streamAssistantUserReplyWithFallback } from '../assistantReplyComposer'
import { resolveDuplicateIntent } from '../duplicateResolutionService'
import { logger } from '../../logger'
import type { ClassificationResult, AgentEvent, DecomposedItem, DocumentType, ConversationEntry } from '../../../shared/types'

export async function* handleThought(
  userInput: string,
  classification: ClassificationResult,
  conversationHistory: readonly ConversationEntry[] = [],
  userInstructionsBlock: string = '',
): AsyncGenerator<AgentEvent> {
  if (classification.thoughtClarification) {
    yield { type: 'chunk', content: classification.thoughtClarification.message }
    yield { type: 'done' }
    return
  }

  yield { type: 'status', message: 'Planning how to split your note or todos…' }
  const today = formatLocalDate(new Date())
  const date = classification.extractedDate ?? today
  const shapePlan = await planSaveShape(userInput, conversationHistory, userInstructionsBlock)
  yield { type: 'status', message: 'Extracting items to store…' }
  const { items } = await decomposeForStorage(userInput, conversationHistory, shapePlan, userInstructionsBlock)

  if (items.length === 0) {
    logger.warn({ userInput }, '[ThoughtHandler] Decomposition returned no items')
    yield { type: 'chunk', content: 'Nothing to save.' }
    yield { type: 'done' }
    return
  }

  if (items.length <= 1) {
    const item = items[0] ?? { content: userInput, type: 'thought' as const, tags: [] }
    const tags = item.tags.length > 0 ? item.tags : classification.extractedTags
    yield* storeSingleItem(
      item.content,
      userInput,
      item.type,
      date,
      tags,
      null,
      userInstructionsBlock,
      conversationHistory,
    )
  } else {
    yield* storeMultipleItems(items, userInput, date, userInstructionsBlock)
  }

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
  const duplicate = await checkForDuplicate(content)

  if (duplicate) {
    const action = await resolveDuplicateIntent(originalInput, conversationHistory, userInstructionsBlock)
    if (action === 'ask') {
      const preview = duplicate.content.slice(0, 120)
      yield { type: 'duplicate', existingContent: preview }
      yield {
        type: 'chunk',
        content:
          'You already have a similar note. Reply with "add new" to save it separately, or "update" to replace the existing one.',
      }
      yield { type: 'done' }
      return
    }
    if (action === 'update') {
      const vector = await embedText(content)
      await updateDocument(duplicate.id, { content, vector })
      yield { type: 'stored', documentId: duplicate.id }
      const preview = content.slice(0, 60) + (content.length > 60 ? '...' : '')
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

  const doc = await storeThought({
    content,
    originalInput,
    type: docType,
    date,
    tags,
  })

  yield { type: 'stored', documentId: doc.id }

  if (customSavedJsonMessage) {
    yield { type: 'chunk', content: customSavedJsonMessage }
    return
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

async function* storeMultipleItems(
  items: readonly DecomposedItem[],
  originalInput: string,
  date: string,
  userInstructionsBlock: string,
): AsyncGenerator<AgentEvent> {
  const groupId = uuidv4()
  let duplicateCount = 0
  let hasTodos = false
  let todoItemCount = 0
  const storedThisBatchIds = new Set<string>()

  for (const item of items) {
    const duplicate = await checkForDuplicate(item.content)
    if (duplicate && !storedThisBatchIds.has(duplicate.id)) {
      duplicateCount += 1
    }

    const itemDocType = item.type
    if (itemDocType === 'todo') {
      hasTodos = true
      todoItemCount += 1
    }

    const doc = await storeThoughtWithMetadata(
      { content: item.content, originalInput, type: itemDocType, date, tags: [...item.tags] },
      { groupId },
    )
    storedThisBatchIds.add(doc.id)

    yield { type: 'stored', documentId: doc.id }
  }

  for await (const chunk of streamAssistantUserReplyWithFallback({
    userInstructionsBlock,
    facts: {
      kind: 'thought_saved_many',
      itemCount: items.length,
      todoItemCount,
      hasTodos,
      duplicateCount,
    },
  })) {
    yield { type: 'chunk', content: chunk }
  }
}

function summarizeTopic(input: string): string {
  const words = input.split(/\s+/).slice(0, 6).join(' ')
  return words.length < input.length ? `${words}...` : words
}
