export interface PromptfooEvalFile {
  readonly results?: {
    readonly results?: readonly PromptfooResultRow[]
  }
}

export interface PromptfooResultRow {
  readonly success?: boolean
  readonly latencyMs?: number
  readonly provider?: {
    readonly label?: string
    readonly id?: string
  }
  readonly testCase?: {
    readonly metadata?: {
      readonly scenarioId?: string
      readonly scenarioTitle?: string
      readonly topic?: string
    }
    readonly description?: string
  }
  readonly vars?: {
    readonly scenarioId?: string
  }
  readonly response?: {
    readonly output?: string
    readonly metadata?: ScenarioMetadata
  }
}

export interface ScenarioMetadata {
  readonly passed?: boolean
  readonly summary?: string
  readonly scenarioId?: string
  readonly scenarioTitle?: string
  readonly model?: string
  readonly agentOrchestrationMode?: string
  readonly judgeModel?: string
  readonly failures?: readonly string[]
  readonly failedChecks?: readonly FailedCheck[]
  readonly transcript?: readonly TranscriptStep[]
  readonly finalTodos?: readonly unknown[]
  readonly evalServerOutput?: string
}

export interface FailedCheck {
  readonly stepIndex?: number
  readonly checkType?: string
  readonly expected?: unknown
  readonly actual?: unknown
  readonly reason?: string
}

export interface TranscriptStep {
  readonly stepIndex?: number
  readonly initialUserInput?: string
  readonly finalUserInput?: string
  readonly response?: string
  readonly events?: readonly StreamEvent[]
  readonly todoContents?: readonly string[]
  readonly retrievedDocumentIds?: readonly string[]
  readonly retrievedContents?: readonly string[]
  readonly retrievedCount?: number
  readonly totalCandidates?: number
  readonly cutoffScore?: number | null
  readonly interactionTurns?: readonly InteractionTurn[]
  readonly failedChecks?: readonly FailedCheck[]
  readonly librarySnapshot?: LibrarySnapshot
}

export interface LibrarySnapshot {
  readonly allDocuments?: readonly unknown[]
  readonly todoDocuments?: readonly unknown[]
}

export interface InteractionTurn {
  readonly turnIndex?: number
  readonly userInput?: string
  readonly response?: string
  readonly events?: readonly StreamEvent[]
  readonly todoContents?: readonly string[]
  readonly retrievedDocumentIds?: readonly string[]
  readonly retrievedContents?: readonly string[]
  readonly retrievedCount?: number
  readonly totalCandidates?: number
  readonly cutoffScore?: number | null
  readonly pipelineTrace?: readonly unknown[]
  readonly traceSchemaVersion?: number
  readonly simulatedUserDecision?: SimulatedUserDecision
}

export interface SimulatedUserDecision {
  readonly selectedUserInput?: string | null
  readonly selectedResponseId?: string | null
  readonly candidateEvaluations?: readonly unknown[]
}

export interface StreamEvent {
  readonly type?: string
  readonly message?: string
  readonly content?: string
  readonly documentId?: string
  readonly documentIds?: readonly string[]
  readonly totalRetrieved?: number
  readonly totalCandidates?: number
}

export interface LatestPointerFile {
  readonly resultFile?: string
  readonly generatedAt?: string
}
