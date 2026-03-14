import { storeThought, checkForDuplicate } from '../documentPipeline'
import type { ClassificationResult, AgentEvent, DocumentType } from '../../../shared/types'

export async function* handleThought(
  userInput: string,
  classification: ClassificationResult,
): AsyncGenerator<AgentEvent> {
  yield { type: 'status', message: 'Saving your thought...' }

  const duplicate = await checkForDuplicate(userInput)
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

  const docType = inferDocumentType(classification.extractedTags)
  const today = new Date().toISOString().split('T')[0]

  const doc = await storeThought({
    content: userInput,
    originalInput: userInput,
    type: docType,
    date: classification.extractedDate ?? today,
    tags: classification.extractedTags,
  })

  yield { type: 'stored', documentId: doc.id }

  if (!duplicate) {
    const topic = classification.extractedTags.length > 0
      ? classification.extractedTags[0]
      : summarizeTopic(userInput)

    yield { type: 'chunk', content: `Got it! I've saved your ${docType} about ${topic}.` }
  }

  yield { type: 'done' }
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
