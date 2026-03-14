import { chat } from '../ollamaService'
import {
  storeThoughtWithMetadata,
  retrieveActiveTodos,
} from '../documentPipeline'
import { updateDocument } from '../lanceService'
import { getSettings } from '../settingsService'
import { RESTRUCTURE_TODO_PROMPT, buildTodoCompletePrompt } from '../../../prompts'
import type {
  ClassificationResult,
  AgentEvent,
  LoreDocument,
  TodoMetadata,
} from '../../../shared/types'

const TODO_COMPLETE_SCHEMA = {
  type: 'object',
  properties: {
    targetId: { type: 'string' },
    confidence: { type: 'number' },
  },
  required: ['targetId', 'confidence'],
}

export async function* handleTodoAdd(
  userInput: string,
  classification: ClassificationResult,
): AsyncGenerator<AgentEvent> {
  yield { type: 'status', message: 'Adding todo...' }

  const settings = getSettings()

  let todoContent = ''
  try {
    const stream = chat({
      model: settings.selectedModel,
      messages: [
        { role: 'user', content: RESTRUCTURE_TODO_PROMPT.replace('{userInput}', userInput) },
      ],
      stream: false,
      think: false,
    })

    for await (const chunk of stream) {
      todoContent += chunk
    }
  } catch {
    todoContent = userInput
  }

  todoContent = todoContent.trim() || userInput

  const existingTodos = await retrieveActiveTodos()
  const nextPosition = existingTodos.length + 1

  const priority = extractPriority(userInput)
  const category = extractCategory(classification.extractedTags)

  const metadata: TodoMetadata = {
    completed: false,
    completedAt: null,
    priority,
    position: nextPosition,
    category,
  }

  const today = new Date().toISOString().split('T')[0]

  const doc = await storeThoughtWithMetadata(
    {
      content: todoContent,
      originalInput: userInput,
      type: 'todo',
      date: classification.extractedDate ?? today,
      tags: classification.extractedTags,
    },
    metadata,
  )

  yield { type: 'stored', documentId: doc.id }

  const priorityLabel = priority ? ` (${priority} priority)` : ''
  yield { type: 'chunk', content: `Added to your todo list${priorityLabel}: "${todoContent}"` }
  yield { type: 'done' }
}

export async function* handleTodoComplete(
  userInput: string,
  classification: ClassificationResult,
): AsyncGenerator<AgentEvent> {
  yield { type: 'status', message: 'Finding todo to complete...' }

  const todos = await retrieveActiveTodos()

  if (todos.length === 0) {
    yield { type: 'chunk', content: "You don't have any active todos to complete." }
    yield { type: 'done' }
    return
  }

  const settings = getSettings()
  const docsForPrompt = todos
    .map((d) => `ID: ${d.id}\nContent: ${d.content}`)
    .join('\n---\n')

  const prompt = buildTodoCompletePrompt(userInput, docsForPrompt)

  let targetId: string | null = null
  try {
    const stream = chat({
      model: settings.selectedModel,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      format: TODO_COMPLETE_SCHEMA,
      think: false,
    })

    let response = ''
    for await (const chunk of stream) {
      response += chunk
    }

    const parsed = JSON.parse(response)
    targetId = typeof parsed.targetId === 'string' ? parsed.targetId : null
  } catch {
    yield { type: 'error', message: 'Failed to identify which todo to complete.' }
    yield { type: 'done' }
    return
  }

  const validIds = new Set(todos.map((t) => t.id))
  if (!targetId || !validIds.has(targetId)) {
    yield { type: 'chunk', content: "I couldn't determine which todo you're referring to. Could you be more specific?" }
    yield { type: 'done' }
    return
  }

  const completedMeta: TodoMetadata = {
    ...parseTodoMeta(todos.find((t) => t.id === targetId)!),
    completed: true,
    completedAt: new Date().toISOString(),
  }

  await updateDocument(targetId, {
    metadata: JSON.stringify(completedMeta),
  })

  const completed = todos.find((t) => t.id === targetId)!
  const preview = completed.content.slice(0, 80)
  yield { type: 'chunk', content: `Done! Marked "${preview}${completed.content.length > 80 ? '...' : ''}" as complete.` }
  yield { type: 'done' }
}

// ── Helpers ───────────────────────────────────────────────────

function parseTodoMeta(doc: LoreDocument): TodoMetadata {
  try {
    const raw = JSON.parse(doc.metadata)
    return {
      completed: raw.completed ?? false,
      completedAt: raw.completedAt ?? null,
      priority: raw.priority ?? null,
      position: raw.position ?? 0,
      category: raw.category ?? null,
    }
  } catch {
    return { completed: false, completedAt: null, priority: null, position: 0, category: null }
  }
}

function extractPriority(input: string): TodoMetadata['priority'] {
  const lower = input.toLowerCase()
  if (/\b(urgent|asap|high\s*priority|important|critical)\b/.test(lower)) return 'high'
  if (/\b(low\s*priority|whenever|not\s*urgent|eventually)\b/.test(lower)) return 'low'
  return null
}

function extractCategory(tags: string[]): string | null {
  const categoryTags = ['work', 'personal', 'home', 'health', 'finance', 'learning']
  for (const tag of tags) {
    if (categoryTags.includes(tag.toLowerCase())) return tag.toLowerCase()
  }
  return null
}

