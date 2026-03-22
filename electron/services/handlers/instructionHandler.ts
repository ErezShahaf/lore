import { storeThought } from '../documentPipeline'
import { retrieveRelevantDocuments } from '../documentPipeline'
import { formatLocalDate } from '../localDate'
import { streamAssistantUserReplyWithFallback } from '../assistantReplyComposer'
import type { ClassificationResult, AgentEvent } from '../../../shared/types'

export async function* handleInstruction(
  userInput: string,
  classification: ClassificationResult,
  userInstructionsBlock: string = '',
): AsyncGenerator<AgentEvent> {
  yield { type: 'status', message: 'Checking for similar saved instructions…' }

  const existing = await retrieveRelevantDocuments(userInput, {
    type: 'instruction',
    similarityThreshold: 0.8,
  })

  yield { type: 'status', message: 'Saving your instruction…' }

  const today = formatLocalDate(new Date())

  const doc = await storeThought({
    content: userInput,
    originalInput: userInput,
    type: 'instruction',
    date: classification.extractedDate ?? today,
    tags: classification.extractedTags,
  })

  yield { type: 'stored', documentId: doc.id }

  const similarInstructionPreviews = existing.map((document) =>
    `${document.content.slice(0, 60)}${document.content.length > 60 ? '...' : ''}`,
  )

  for await (const chunk of streamAssistantUserReplyWithFallback({
    userInstructionsBlock,
    facts: {
      kind: 'instruction_stored',
      similarInstructionPreviews,
    },
  })) {
    yield { type: 'chunk', content: chunk }
  }
  yield { type: 'done' }
}
