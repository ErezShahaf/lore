export interface ThoughtDocument {
  id: string
  content: string
  type: 'thought' | 'todo' | 'instruction'
  embedding?: number[]
  createdAt: string
  updatedAt: string
  metadata?: Record<string, unknown>
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
