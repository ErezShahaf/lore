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

export interface ScoredDocument extends LoreDocument {
  score: number
}

export interface RetrievedDocumentSet {
  documents: ScoredDocument[]
  totalCandidates: number
  cutoffScore: number
}

export interface RetrievalOptions {
  type?: DocumentType
  dateFrom?: string
  dateTo?: string
  tags?: string[]
  maxResults?: number
  similarityThreshold?: number
}

export interface DatabaseStats {
  totalDocuments: number
  deletedDocuments: number
  documentsByType: Record<string, number>
}

export interface ConversationEntry {
  role: 'user' | 'assistant'
  content: string
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
  ollamaPath: string
  ollamaModelsPath: string
  ollamaSetupComplete: boolean
}

export interface OllamaModel {
  name: string
  modifiedAt: string
  size: number
  digest: string
}

export interface ChatRequestOptions {
  num_ctx?: number
}

export interface ChatRequest {
  model: string
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  stream: boolean
  format?: 'json' | Record<string, unknown>
  think?: boolean
  options?: ChatRequestOptions
  keep_alive?: number | string
}

export interface PullProgress {
  status: string
  digest?: string
  total?: number
  completed?: number
}

export interface ActivePullProgress extends PullProgress {
  model: string
}

export interface OllamaStatus {
  connected: boolean
  error?: string
}

export interface OllamaSetupProgress {
  phase: 'downloading' | 'starting' | 'ready' | 'error'
  percent: number
  message: string
}

export type InputClassification =
  | 'thought'
  | 'question'
  | 'command'
  | 'instruction'
  | 'conversational'

// ── Save decomposition ───────────────────────────────────────

export interface SaveDecompositionResult {
  items: string[]
}

// ── Agent classification & routing ───────────────────────────

export type ThoughtSubtype = 'general'
export type QuestionSubtype = 'general'
export type CommandSubtype = 'delete' | 'update' | 'reorder'
export type InstructionSubtype = 'general'
export type ConversationalSubtype = 'greeting' | 'usage' | 'reaction'

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
  action: 'delete' | 'update'
  updatedContent: string | null
  confidence: number
}

// ── Command decomposition ─────────────────────────────────────

export interface CommandOperation {
  targetDocumentIds: string[]
  action: 'delete' | 'update'
  updatedContent: string | null
  confidence: number
  description: string
}

export type CommandResolution =
  | { status: 'execute'; operations: CommandOperation[]; clarificationMessage: null }
  | { status: 'clarify'; operations: []; clarificationMessage: string }

export type AgentEvent =
  | { type: 'status'; message: string }
  | { type: 'chunk'; content: string }
  | { type: 'stored'; documentId: string }
  | { type: 'deleted'; documentId: string }
  | { type: 'duplicate'; existingContent: string }
  | { type: 'error'; message: string }
  | { type: 'done' }

// ── System info & hardware detection ─────────────────────────

export interface SystemInfo {
  platform: 'win32' | 'darwin' | 'linux'
  osVersion: string
  arch: string
  totalMemoryGB: number
  freeMemoryGB: number
  cpuModel: string
  cpuCores: number
  gpu: GpuInfo | null
}

export interface GpuInfo {
  vendor: 'nvidia' | 'amd' | 'intel' | 'apple' | 'unknown'
  vendorString: string
  deviceString: string
  vramMB: number | null
  cudaSupported: boolean
  metalSupported: boolean
  rocmSupported: boolean
}

export type ModelTier = 'small' | 'medium' | 'large'

export interface HardwareProfile {
  maxModelTier: ModelTier
  maxParametersBillions: number
  gpuAcceleration: boolean
  gpuAccelerationType: 'cuda' | 'metal' | 'rocm' | 'none'
  warnings: string[]
}

export interface ModelVariant {
  tag: string
  quantization: string
  sizeOnDisk: string
  minRAMGB: number
}

export interface RecommendedModel {
  displayName: string
  parametersBillions: number
  tier: ModelTier
  category: 'chat' | 'embedding'
  description: string
  gpuRecommended: boolean
  variants: ModelVariant[]
}
