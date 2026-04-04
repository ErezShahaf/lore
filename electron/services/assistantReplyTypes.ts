import type { DocumentType, RetrievalContextDocument } from '../../shared/types'

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
      /**
       * Each string is one similar library item’s body — must appear verbatim in the user-facing message.
       */
      readonly existingSimilarContents: readonly string[]
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
      readonly kind: 'save_input_empty'
      /** Why nothing could be stored for this path. */
      readonly emptyReason: 'empty_turn' | 'empty_multi_action_step' | 'resolved_body_empty'
    }
  | {
      readonly kind: 'save_duplicate_replace_blocked'
      /** No duplicate target id was available to update in place. */
    }
  | {
      readonly kind: 'save_body_clarify_structured_intent'
    }
  | {
      readonly kind: 'save_body_clarify_short_title'
    }
  | {
      readonly kind: 'command_resolution_failed'
    }
  | {
      readonly kind: 'command_target_clarify'
      readonly commandIntent: 'edit' | 'delete'
      /**
       * Numbered option lines and blockquoted bodies only; must appear verbatim in the user-facing message.
       */
      readonly verbatimNumberedOptionsBlock: string
    }
  | {
      readonly kind: 'command_clarify_uncertain'
      readonly hint: string | null
    }
  | {
      readonly kind: 'command_clarify_model_text'
      /** Text from the command decomposer model; keep meaning and any numbering. */
      readonly text: string
    }
  | {
      readonly kind: 'orchestrator_surface_fallback'
      readonly trigger: 'empty_decision_reply' | 'empty_stream_result' | 'max_steps_exhausted'
    }
  | {
      readonly kind: 'todo_list_present'
      /** Preformatted markdown lines (e.g. "- buy milk"); must appear verbatim in order. */
      readonly bulletLines: readonly string[]
      readonly userSurfaceInput: string
      readonly shouldEchoGreeting: boolean
    }
  | {
    readonly kind: 'multi_action_summary'
      /** Exact user message for this turn (composer uses this to judge full-text vs summary intent). */
      readonly turnUserMessage: string
      readonly outcomes: readonly {
        readonly intent: string
        readonly saveDocumentType: DocumentType | null
        readonly situationSummary: string
        readonly status: 'succeeded' | 'failed'
        readonly message: string
        readonly handlerResultSummary: string
        readonly duplicateSaveClarificationPending: boolean
        readonly commandTargetClarificationPending: boolean
        readonly storedDocumentIds: readonly string[]
        readonly retrievedDocumentIds: readonly string[]
        readonly deletedDocumentCount: number
        readonly retrievedDocumentsForComposer: readonly RetrievalContextDocument[]
      }[]
    }
