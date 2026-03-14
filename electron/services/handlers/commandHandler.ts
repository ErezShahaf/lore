import { chat } from '../ollamaService'
import { retrieveRelevantDocuments } from '../documentPipeline'
import { softDeleteDocument, updateDocument } from '../lanceService'
import { getSettings } from '../settingsService'
import { embedText } from '../embeddingService'
import { TARGET_IDENTIFICATION_PROMPT } from '../../../prompts'
import type {
  ClassificationResult,
  AgentEvent,
  LoreDocument,
  CommandTarget,
} from '../../../shared/types'

const COMMAND_TARGET_SCHEMA = {
  type: 'object',
  properties: {
    targetDocumentIds: {
      type: 'array',
      items: { type: 'string' },
    },
    action: {
      type: 'string',
      enum: ['delete', 'update', 'complete'],
    },
    updatedContent: { type: 'string' },
    confidence: { type: 'number' },
  },
  required: ['targetDocumentIds', 'action', 'updatedContent', 'confidence'],
}

export async function* handleCommand(
  userInput: string,
  classification: ClassificationResult,
): AsyncGenerator<AgentEvent> {
  yield { type: 'status', message: 'Finding relevant documents...' }

  const settings = getSettings()
  const retrievalOpts = classification.subtype === 'complete'
    ? { type: 'todo' as const }
    : undefined
  const documents = await retrieveRelevantDocuments(userInput, retrievalOpts)

  if (documents.length === 0) {
    yield {
      type: 'chunk',
      content: "I couldn't find any documents matching your request. Could you be more specific?",
    }
    yield { type: 'done' }
    return
  }

  yield { type: 'status', message: 'Identifying target...' }

  const docsForPrompt = documents
    .map((d) => `ID: ${d.id}\nType: ${d.type}\nDate: ${d.date}\nContent: ${d.content}`)
    .join('\n---\n')

  const prompt = TARGET_IDENTIFICATION_PROMPT
    .replace('{action}', classification.subtype)
    .replace('{userInput}', userInput)
    .replace('{documents}', docsForPrompt)

  let target: CommandTarget
  try {
    const stream = chat({
      model: settings.selectedModel,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      format: COMMAND_TARGET_SCHEMA,
      think: false,
    })

    let response = ''
    for await (const chunk of stream) {
      response += chunk
    }

    const parsed = JSON.parse(response)
    target = {
      targetDocumentIds: Array.isArray(parsed.targetDocumentIds)
        ? parsed.targetDocumentIds
        : [],
      action: validateAction(parsed.action),
      updatedContent:
        typeof parsed.updatedContent === 'string' ? parsed.updatedContent : null,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
    }
  } catch (err) {
    yield {
      type: 'error',
      message: 'Failed to identify which document to modify. Please try being more specific.',
    }
    yield { type: 'done' }
    return
  }

  if (target.targetDocumentIds.length === 0) {
    yield {
      type: 'chunk',
      content: "I couldn't determine which document you're referring to. Could you be more specific?",
    }
    yield { type: 'done' }
    return
  }

  const validIds = new Set(documents.map((d) => d.id))
  const confirmedIds = target.targetDocumentIds.filter((id) => validIds.has(id))

  if (confirmedIds.length === 0) {
    yield {
      type: 'chunk',
      content: "I couldn't match your request to any stored documents.",
    }
    yield { type: 'done' }
    return
  }

  yield { type: 'status', message: `Executing ${target.action}...` }

  const affected = documents.filter((d) => confirmedIds.includes(d.id))

  switch (target.action) {
    case 'delete':
      for (const id of confirmedIds) {
        await softDeleteDocument(id)
        yield { type: 'deleted', documentId: id }
      }
      yield {
        type: 'chunk',
        content: buildDeleteConfirmation(affected),
      }
      break

    case 'update':
      for (const id of confirmedIds) {
        const updates: Partial<LoreDocument> = {}
        if (target.updatedContent) {
          updates.content = target.updatedContent
          updates.vector = await embedText(target.updatedContent)
        }
        await updateDocument(id, updates)
      }
      yield {
        type: 'chunk',
        content: `Done! I've updated ${confirmedIds.length === 1 ? 'the document' : `${confirmedIds.length} documents`}.`,
      }
      break

    case 'complete':
      for (const id of confirmedIds) {
        await updateDocument(id, {
          metadata: JSON.stringify({ completed: true, completedAt: new Date().toISOString() }),
        })
      }
      yield {
        type: 'chunk',
        content: buildCompleteConfirmation(affected),
      }
      break
  }

  yield { type: 'done' }
}

function validateAction(value: unknown): CommandTarget['action'] {
  const valid = ['delete', 'update', 'complete']
  return valid.includes(value as string) ? (value as CommandTarget['action']) : 'delete'
}

function buildDeleteConfirmation(docs: LoreDocument[]): string {
  if (docs.length === 1) {
    const preview = docs[0].content.slice(0, 80)
    return `Done! I've removed "${preview}${docs[0].content.length > 80 ? '...' : ''}" from your notes.`
  }
  return `Done! I've removed ${docs.length} documents from your notes.`
}

function buildCompleteConfirmation(docs: LoreDocument[]): string {
  if (docs.length === 1) {
    const preview = docs[0].content.slice(0, 80)
    return `Done! I've marked "${preview}${docs[0].content.length > 80 ? '...' : ''}" as complete.`
  }
  return `Done! I've marked ${docs.length} items as complete.`
}
