import type { DocumentType } from '../../shared/types'

/**
 * Serializable facts for {@link streamAssistantUserReply}. The model may phrase the reply freely
 * but must not contradict these fields.
 */
export type AssistantReplyFacts =
  | {
    readonly kind: 'thought_saved_single'
    readonly documentType: DocumentType
    readonly topicSummary: string
    readonly hadDuplicate: boolean
    readonly duplicatePreview: string | null
  }
  | {
      readonly kind: 'thought_saved_many'
      readonly itemCount: number
      readonly todoItemCount: number
      readonly hasTodos: boolean
      readonly duplicateCount: number
    }
  | {
    readonly kind: 'instruction_stored'
    readonly similarInstructionPreviews: readonly string[]
  }
  | {
    readonly kind: 'command_no_documents'
  }
  | {
    readonly kind: 'command_no_match'
  }
  | {
    readonly kind: 'command_executed'
    readonly operations: readonly {
      readonly action: 'delete' | 'update'
      readonly contentPreview: string
    }[]
  }
