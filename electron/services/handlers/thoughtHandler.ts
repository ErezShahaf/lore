import { v4 as uuidv4 } from 'uuid'
import { storeThought, storeThoughtWithMetadata, checkForDuplicate } from '../documentPipeline'
import { formatLocalDate } from '../localDate'
import { decomposeForStorage } from '../saveDecompositionService'
import type { ClassificationResult, AgentEvent, DecomposedItem, DocumentType, ConversationEntry } from '../../../shared/types'

export async function* handleThought(
  userInput: string,
  classification: ClassificationResult,
  conversationHistory: readonly ConversationEntry[] = [],
): AsyncGenerator<AgentEvent> {
  yield { type: 'status', message: 'Saving your thought...' }

  const { items } = await decomposeForStorage(userInput, conversationHistory)
  const today = formatLocalDate(new Date())
  const date = classification.extractedDate ?? today

  if (items.length <= 1) {
    const item = items[0] ?? { content: userInput, type: 'thought' as const, tags: [] }
    const tags = item.tags.length > 0 ? item.tags : classification.extractedTags
    yield* storeSingleItem(item.content, userInput, item.type, date, tags)
  } else {
    yield* storeMultipleItems(items, userInput, date)
  }

  yield { type: 'done' }
}

async function* storeSingleItem(
  content: string,
  originalInput: string,
  docType: DocumentType,
  date: string,
  tags: readonly string[],
): AsyncGenerator<AgentEvent> {
  const duplicate = await checkForDuplicate(content)
  if (duplicate) {
    const preview = duplicate.content.slice(0, 120)
    yield {
      type: 'duplicate',
      existingContent: preview,
    }
    yield {
      type: 'chunk',
      content: `This seems similar to a note you already have: "${preview}${duplicate.content.length > 120 ? '...' : ''}"\n\nI've saved it as a new note anyway, but you may want to delete the duplicate.`,
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

  if (!duplicate) {
    const topic = summarizeTopic(content)
    yield { type: 'chunk', content: `Got it! I've saved your ${docType} about ${topic}.` }
  }
}

async function* storeMultipleItems(
  items: readonly DecomposedItem[],
  originalInput: string,
  date: string,
): AsyncGenerator<AgentEvent> {
  const groupId = uuidv4()
  let duplicateCount = 0
  let hasTodos = false

  for (const item of items) {
    const duplicate = await checkForDuplicate(item.content)
    if (duplicate) duplicateCount++

    const itemDocType = item.type
    if (itemDocType === 'todo') hasTodos = true

    const doc = await storeThoughtWithMetadata(
      { content: item.content, originalInput, type: itemDocType, date, tags: [...item.tags] },
      { groupId },
    )

    yield { type: 'stored', documentId: doc.id }
  }

  const typeLabel = hasTodos ? 'todos' : 'notes'
  let message = `Got it! I've saved ${items.length} ${typeLabel}.`
  if (duplicateCount > 0) {
    message += ` (${duplicateCount} seemed similar to notes you already have.)`
  }
  yield { type: 'chunk', content: message }
}

function summarizeTopic(input: string): string {
  const words = input.split(/\s+/).slice(0, 6).join(' ')
  return words.length < input.length ? `${words}...` : words
}
