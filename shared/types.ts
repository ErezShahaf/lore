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
/** Document kinds the unified classifier may choose for `save` (includes standing user instructions). */
export type DecomposedDocumentType = DocumentType

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
  tags: readonly string[]
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
  ids?: string[]
  type?: DocumentType
  dateFrom?: string
  dateTo?: string
  createdAtFrom?: string
  createdAtTo?: string
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
  preferredDisplayId: number | null
  selectedModel: string
  embeddingModel: string
  ollamaHost: string
  ollamaPath: string
  ollamaModelsPath: string
  ollamaSetupComplete: boolean
}

export interface DisplayInfo {
  id: number
  label: string
  isPrimary: boolean
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

// ── Tool calling (Ollama native) ──────────────────────────────

export interface ToolFunction {
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown>
}

export interface OllamaTool {
  readonly type: 'function'
  readonly function: ToolFunction
}

export interface ToolCall {
  readonly function: {
    readonly name: string
    readonly arguments: Record<string, unknown>
  }
}

export type ToolMessageRole = 'system' | 'user' | 'assistant' | 'tool'

export interface ToolChatMessage {
  readonly role: ToolMessageRole
  readonly content: string
  readonly tool_calls?: readonly ToolCall[]
}

export interface ToolChatRequest {
  readonly model: string
  readonly messages: readonly ToolChatMessage[]
  readonly tools: readonly OllamaTool[]
  readonly options?: ChatRequestOptions
}

export interface ToolChatResponse {
  readonly message: ToolChatMessage
}

export interface OrchestratorCallAction {
  readonly action: 'call'
  readonly agent: string
  readonly params?: Record<string, unknown>
}

export interface OrchestratorReplyAction {
  readonly action: 'reply'
  readonly content: string
}

export type OrchestratorAction = OrchestratorCallAction | OrchestratorReplyAction

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
  | 'read'
  | 'save'
  | 'edit'
  | 'delete'
  | 'speak'

// ── Agent classification & routing ───────────────────────────

export interface SituationSummary {
  readonly situationSummary: string
  readonly assistantRecentlyAskedForClarification: boolean
}

export interface IntentRouteResult {
  readonly intent: InputClassification
  readonly confidence: number
  readonly reasoning: string
}

export interface ThoughtClarification {
  readonly type: 'clarify' | 'suggest_description'
  readonly message: string
}

export interface MetadataExtractionResult {
  readonly extractedDate: string | null
  readonly extractedTags: string[]
}

export interface QuestionStrategyResult {
  readonly mode: 'answer' | 'ask_clarification'
  readonly clarificationMessage: string | null
}

/** Single action from classification; each field is specific to this action. */
export interface ClassificationAction {
  intent: InputClassification
  extractedDate: string | null
  extractedTags: string[]
  situationSummary: string
  /** Content the intent works on (e.g. text to save, item to delete). */
  data: string
  /**
   * For `save`: document kind to store. For every other intent: null.
   */
  readonly saveDocumentType: DecomposedDocumentType | null
}

/** Classification returns an array of actions; backwards compat for single-action shape. */
export interface ClassificationResult {
  actions: readonly ClassificationAction[]
}

/** First action from unified classification, or a safe speak fallback when the array is empty. */
export function primaryClassificationAction(result: ClassificationResult): ClassificationAction {
  const first = result.actions[0]
  if (first !== undefined) {
    return first
  }
  return {
    intent: 'speak',
    extractedDate: null,
    extractedTags: [],
    situationSummary: '',
    data: '',
    saveDocumentType: null,
  }
}

/** Shape passed to handlers; satisfied by ClassificationAction. */
export type HandlerClassification = Pick<
  ClassificationAction,
  'intent' | 'extractedDate' | 'extractedTags' | 'situationSummary' | 'data' | 'saveDocumentType'
>

/** Single action as handler input; backwards compatible with old ClassificationResult. */
export type ClassificationForHandler = HandlerClassification

/** Outcome of processing one action for the turn-level reply composer. */
export interface ActionOutcome {
  readonly intent: InputClassification
  readonly situationSummary: string
  readonly status: 'succeeded' | 'failed'
  readonly message: string
  /**
   * Short ground-truth description of what the sub-handler did (duplicate prompt, stored id, zero hits, …).
   * The final composer should treat this plus structured ids as authoritative over `message` when they conflict.
   */
  readonly handlerResultSummary: string
  readonly storedDocumentIds: readonly string[]
  readonly retrievedDocumentIds: readonly string[]
  readonly deletedDocumentCount: number
}

/** Bump when pipeline stage record shapes change (summarizer heuristics may depend on version). */
export const PIPELINE_TRACE_SCHEMA_VERSION = 1 as const

export type PipelineStageId =
  | 'unified_classifier'
  | 'action_execution'
  | 'assistant_reply_composer'

/** Subset of {@link ActionOutcome} stored in eval traces (compact; message truncated elsewhere). */
export interface PipelineActionExecutionTraceOutput {
  readonly actionIndex: number
  readonly intent: InputClassification
  readonly status: 'succeeded' | 'failed'
  readonly handlerResultSummary: string
  readonly storedDocumentIds: readonly string[]
  readonly retrievedDocumentIds: readonly string[]
  readonly deletedDocumentCount: number
  readonly messagePreview: string
}

export interface PipelineAssistantReplyComposerTraceOutput {
  readonly factsKind: string
  readonly facts: unknown
  readonly composedReplyPreview: string
  readonly modelLabel: string | null
}

export type PipelineStageRecord =
  | {
      readonly stageId: 'unified_classifier'
      readonly ordinal: number
      readonly timestamp?: string
      readonly output: ClassificationResult
    }
  | {
      readonly stageId: 'action_execution'
      readonly ordinal: number
      readonly timestamp?: string
      readonly output: PipelineActionExecutionTraceOutput
    }
  | {
      readonly stageId: 'assistant_reply_composer'
      readonly ordinal: number
      readonly timestamp?: string
      readonly output: PipelineAssistantReplyComposerTraceOutput
    }

/** Serialized trace for one user message (eval / Promptfoo metadata). */
export interface PipelineTracePayload {
  readonly traceSchemaVersion: typeof PIPELINE_TRACE_SCHEMA_VERSION
  readonly stages: readonly PipelineStageRecord[]
}

/** In-memory sink while {@link runMultiActionTurn} runs; copy into {@link PipelineTracePayload} when done. */
export interface MutablePipelineTraceSink {
  traceSchemaVersion: typeof PIPELINE_TRACE_SCHEMA_VERSION
  stages: PipelineStageRecord[]
}

/** Mutable accumulator for one user turn; updated by [orchestratorService](electron/services/orchestratorService.ts). */
export interface OrchestratorTurnResult {
  assistantResponse: string
  classification: ClassificationResult | null
  lastDocumentIds: string[]
  completedDispatcherIds: string[]
  /** All saved instruction documents loaded once per turn for system-prompt injection. */
  userInstructionDocuments: readonly LoreDocument[]
  /** Formatted block derived from [userInstructionDocuments](OrchestratorTurnResult.userInstructionDocuments). */
  userInstructionsBlock: string
}

/**
 * Max loop iterations for the orchestrator (future: retrieve → branch → re-dispatch).
 * Current implementation uses a single dispatch after classification.
 */
export const ORCHESTRATOR_MAX_STEPS = 8

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

export interface RetrievedAgentEvent {
  readonly type: 'retrieved'
  readonly documentIds: string[]
  readonly totalRetrieved?: number
  readonly totalCandidates?: number
  readonly cutoffScore?: number
}

export type AgentEvent =
  | { type: 'status'; message: string }
  | { type: 'chunk'; content: string }
  | RetrievedAgentEvent
  | { type: 'stored'; documentId: string }
  | { type: 'deleted'; documentId: string }
  | { type: 'duplicate'; existingContent: string }
  | { type: 'error'; message: string }
  /**
   * Factual one-line execution trace for this handler step (not shown in chat).
   * Used when the turn ends with a multi-action summary so the composer knows what each sub-step did.
   */
  | { type: 'turn_step_summary'; summary: string }
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
