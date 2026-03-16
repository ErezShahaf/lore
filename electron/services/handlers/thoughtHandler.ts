import { v4 as uuidv4 } from 'uuid'
import { storeThought, storeThoughtWithMetadata, checkForDuplicate } from '../documentPipeline'
import { decomposeForStorage } from '../saveDecompositionService'
import type { ClassificationResult, AgentEvent, DocumentType, ConversationEntry } from '../../../shared/types'

export async function* handleThought(
  userInput: string,
  classification: ClassificationResult,
  conversationHistory: readonly ConversationEntry[] = [],
): AsyncGenerator<AgentEvent> {
  yield { type: 'status', message: 'Saving your thought...' }

  const { items } = await decomposeForStorage(userInput, conversationHistory)
  const docType = inferDocumentType(classification.extractedTags)
  const today = new Date().toISOString().split('T')[0]
  const date = classification.extractedDate ?? today
  const tags = classification.extractedTags

  if (items.length <= 1) {
    yield* storeSingleItem(items[0] ?? userInput, userInput, docType, date, tags)
  } else {
    yield* storeMultipleItems(items, userInput, docType, date, tags)
  }

  yield { type: 'done' }
}

async function* storeSingleItem(
  content: string,
  originalInput: string,
  docType: DocumentType,
  date: string,
  tags: string[],
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
  items: string[],
  originalInput: string,
  docType: DocumentType,
  date: string,
  tags: string[],
): AsyncGenerator<AgentEvent> {
  const groupId = uuidv4()
  let duplicateCount = 0

  for (const item of items) {
    const duplicate = await checkForDuplicate(item)
    if (duplicate) duplicateCount++

    const doc = await storeThoughtWithMetadata(
      { content: item, originalInput, type: docType, date, tags },
      { groupId },
    )

    yield { type: 'stored', documentId: doc.id }
  }

  const typeLabel = docType === 'todo' ? 'todos' : 'notes'
  let message = `Got it! I've saved ${items.length} ${typeLabel}.`
  if (duplicateCount > 0) {
    message += ` (${duplicateCount} seemed similar to notes you already have.)`
  }
  yield { type: 'chunk', content: message }
}

function inferDocumentType(tags: string[]): DocumentType {
  const lowerTags = tags.map((t) => t.toLowerCase())
  if (lowerTags.includes('todo')) return 'todo'
  return 'thought'
}

function summarizeTopic(input: string): string {
  const words = input.split(/\s+/).slice(0, 6).join(' ')
  return words.length < input.length ? `${words}...` : words
}
