export interface ThoughtDocument {
  id: string
  content: string
  type: 'thought' | 'todo' | 'instruction'
  embedding?: number[]
  createdAt: string
  updatedAt: string
  metadata?: Record<string, unknown>
}

// ── Vector database types ─────────────────────────────────────

export type DocumentType = 'thought' | 'todo' | 'instruction' | 'meeting' | 'note'

export interface LoreDocument {
  id: string
  content: string
  vector: Float32Array
  type: DocumentType
  createdAt: string
  updatedAt: string
  date: string
  tags: string
  source: string
  metadata: string
  isDeleted: boolean
}

export interface StoreThoughtInput {
  content: string
  originalInput: string
  type: DocumentType
  date: string
  tags: string[]
}

export interface RetrievalOptions {
  type?: DocumentType
  dateFrom?: string
  dateTo?: string
  maxResults?: number
  similarityThreshold?: number
}

export interface DatabaseStats {
  totalDocuments: number
  deletedDocuments: number
  documentsByType: Record<string, number>
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  isStreaming?: boolean
}

export interface AppSettings {
  shortcut: string
  startOnLogin: boolean
  hideOnBlur: boolean
  selectedModel: string
  embeddingModel: string
  ollamaHost: string
}

export interface OllamaModel {
  name: string
  modifiedAt: string
  size: number
  digest: string
}

export interface ChatRequest {
  model: string
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  stream: boolean
  format?: 'json'
}

export interface PullProgress {
  status: string
  digest?: string
  total?: number
  completed?: number
}

export interface OllamaStatus {
  connected: boolean
  error?: string
}

export type InputClassification =
  | 'thought'
  | 'question'
  | 'command'
  | 'instruction'

// ── Agent classification & routing ───────────────────────────

export type ThoughtSubtype = 'general' | 'meeting' | 'idea' | 'learning' | 'todo'
export type QuestionSubtype = 'recall' | 'search' | 'summary' | 'list'
export type CommandSubtype = 'delete' | 'update' | 'complete' | 'reorder'
export type InstructionSubtype = 'preference' | 'rule' | 'alias'

export interface ClassificationResult {
  intent: InputClassification
  subtype: string
  extractedDate: string | null
  extractedTags: string[]
  confidence: number
  reasoning: string
}

export interface CommandTarget {
  targetDocumentIds: string[]
  action: 'delete' | 'update' | 'complete'
  updatedContent: string | null
  confidence: number
}

export type AgentEvent =
  | { type: 'status'; message: string }
  | { type: 'chunk'; content: string }
  | { type: 'stored'; documentId: string }
  | { type: 'deleted'; documentId: string }
  | { type: 'error'; message: string }
  | { type: 'done' }
