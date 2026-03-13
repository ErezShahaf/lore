import { chat } from '../ollamaService'
import { storeThought } from '../documentPipeline'
import { getSettings } from '../settingsService'
import type { ClassificationResult, AgentEvent, DocumentType } from '../../../shared/types'

const RESTRUCTURE_PROMPT = `Restructure the following raw thought into a clear, well-organized note.
Preserve all information but improve clarity and structure.
If it contains action items, format them as a bullet list.
If it mentions specific dates, people, or projects, highlight them.
Keep it concise. Do NOT wrap in markdown code fences. Return only the restructured note.

Raw input: {userInput}`

export async function* handleThought(
  userInput: string,
  classification: ClassificationResult,
): AsyncGenerator<AgentEvent> {
  yield { type: 'status', message: 'Processing your thought...' }

  const settings = getSettings()
  const docType = mapSubtypeToDocType(classification.subtype)

  let restructured = ''
  try {
    const stream = chat({
      model: settings.selectedModel,
      messages: [
        { role: 'user', content: RESTRUCTURE_PROMPT.replace('{userInput}', userInput) },
      ],
      stream: true,
    })

    for await (const chunk of stream) {
      restructured += chunk
    }
  } catch {
    restructured = userInput
  }

  const today = new Date().toISOString().split('T')[0]

  const doc = await storeThought({
    content: restructured.trim() || userInput,
    originalInput: userInput,
    type: docType,
    date: classification.extractedDate ?? today,
    tags: classification.extractedTags,
  })

  yield { type: 'stored', documentId: doc.id }

  const topic = classification.extractedTags.length > 0
    ? classification.extractedTags[0]
    : summarizeTopic(userInput)

  yield { type: 'chunk', content: `Got it! I've saved your ${docType} about ${topic}.` }
  yield { type: 'done' }
}

function mapSubtypeToDocType(subtype: string): DocumentType {
  const map: Record<string, DocumentType> = {
    meeting: 'meeting',
    todo: 'todo',
    idea: 'note',
    learning: 'note',
    general: 'thought',
  }
  return map[subtype] ?? 'thought'
}

function summarizeTopic(input: string): string {
  const words = input.split(/\s+/).slice(0, 6).join(' ')
  return words.length < input.length ? `${words}...` : words
}
