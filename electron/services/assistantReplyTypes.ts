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
    /** Verbatim excerpt of what was stored (especially JSON); do not replace with a prose summary. */
    readonly storedContentPreview: string | null
  }
  | {
      readonly kind: 'duplicate_save_clarification_pending'
      readonly documentType: DocumentType
      /** Exact text of the note already in the library (must appear verbatim in the user-facing message). */
      readonly existingNoteContent: string
      /** Content the user is trying to store (may be shown or summarized; nothing was written yet). */
      readonly pendingNewContent: string
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
  | {
      readonly kind: 'multi_action_summary'
      readonly outcomes: readonly {
        readonly intent: string
        readonly saveDocumentType: DocumentType | null
        readonly situationSummary: string
        readonly status: 'succeeded' | 'failed'
        readonly message: string
        readonly handlerResultSummary: string
        readonly duplicateSaveClarificationPending: boolean
        readonly storedDocumentIds: readonly string[]
        readonly retrievedDocumentIds: readonly string[]
        readonly deletedDocumentCount: number
      }[]
    }
