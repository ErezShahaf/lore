import { storeThought } from '../documentPipeline'
import { retrieveRelevantDocuments } from '../documentPipeline'
import type { ClassificationResult, AgentEvent } from '../../../shared/types'

export async function* handleInstruction(
  userInput: string,
  classification: ClassificationResult,
): AsyncGenerator<AgentEvent> {
  yield { type: 'status', message: 'Saving instruction...' }

  const existing = await retrieveRelevantDocuments(userInput, {
    type: 'instruction',
    maxResults: 3,
    similarityThreshold: 0.8,
  })

  const today = new Date().toISOString().split('T')[0]

  const doc = await storeThought({
    content: userInput,
    originalInput: userInput,
    type: 'instruction',
    date: classification.extractedDate ?? today,
    tags: classification.extractedTags,
  })

  yield { type: 'stored', documentId: doc.id }

  let response = "Got it! I'll remember that from now on."

  if (existing.length > 0) {
    const previews = existing
      .map((d) => `"${d.content.slice(0, 60)}${d.content.length > 60 ? '...' : ''}"`)
      .join(', ')
    response += `\n\nNote: I found similar existing instructions: ${previews}. Both will be active — if you want to replace the old one, just ask me to delete it.`
  }

  yield { type: 'chunk', content: response }
  yield { type: 'done' }
}
