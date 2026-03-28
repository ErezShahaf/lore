/**
 * Single source of truth for skill directory layout under `skills/skill-classification/`.
 *
 * Per node: `entry.md`, then optional `decisions/` (branches / selectors) and optional `shared/`
 * (mounted agents and reusable material that are not fork dimensions). Same pattern recurses.
 *
 * Classifier routes: `decisions/{read,save,command,speak,reply,shared}/`.
 * Non-classifier helpers: `shared/auxiliary/` (not an `intent`).
 *
 * `skillTreeAlignment` tests enforce disk layout.
 */
export const SKILL_MOUNT_SEGMENTS: Readonly<Record<string, readonly string[]>> = {
  'question-answer': ['decisions', 'read', 'decisions', 'question-answer'],
  'question-strategist': ['decisions', 'read', 'decisions', 'question-strategist'],
  'skill-worker-question': ['decisions', 'read', 'decisions', 'skill-worker-question'],
  'skill-worker-thought': ['decisions', 'save', 'decisions', 'skill-worker-thought'],
  'duplicate-resolution': ['decisions', 'save', 'decisions', 'duplicate-resolution'],
  'duplicate-prompt-follow-up': ['decisions', 'save', 'decisions', 'duplicate-prompt-follow-up'],
  'save-note-body-resolution': ['decisions', 'save', 'decisions', 'save-note-body-resolution'],
  'skill-worker-instruction': ['decisions', 'save', 'decisions', 'skill-worker-instruction'],
  'command-decomposition': ['decisions', 'command', 'decisions', 'command-decomposition'],
  'skill-worker-command': ['decisions', 'command', 'decisions', 'skill-worker-command'],
  'skill-worker-conversational': ['decisions', 'speak', 'shared', 'skill-worker-conversational'],
  'assistant-user-reply': ['decisions', 'reply', 'shared', 'assistant-user-reply'],
  'skill-shared-protocol': ['decisions', 'shared', 'shared', 'skill-shared-protocol'],
  'situation': ['shared', 'auxiliary', 'decisions', 'situation'],
  'intent-route': ['shared', 'auxiliary', 'decisions', 'intent-route'],
  'metadata-extraction': ['shared', 'auxiliary', 'decisions', 'metadata-extraction'],
  'orchestrator-low-confidence': ['shared', 'auxiliary', 'decisions', 'orchestrator-low-confidence'],
} as const

/**
 * Maps `WorkerKind` in `workerRouter` to `SKILL_MOUNT_SEGMENTS` keys.
 * Keeps tool-orchestrator workers aligned with the classification tree after directory moves.
 */
export const WORKER_KIND_TO_SKILL_MOUNT_ID: Readonly<
  Record<'question' | 'thought' | 'command' | 'conversational', keyof typeof SKILL_MOUNT_SEGMENTS>
> = {
  question: 'skill-worker-question',
  thought: 'skill-worker-thought',
  command: 'skill-worker-command',
  conversational: 'skill-worker-conversational',
}

/** Matches `questionHandler` → `loadSkill('question-answer', questionAnswerSelectors)`. */
export const QUESTION_ANSWER_FORK_OUTCOMES: Readonly<Record<string, readonly string[]>> = {
  retrievalStatus: ['empty', 'non_empty', 'default'],
  todoListing: ['yes', 'no', 'default'],
  structuredRetrieved: ['yes', 'no', 'default'],
} as const

/** Matches `AssistantReplyFacts['kind']` plus `default` fallback; see `assistantReplyComposer`. */
export const ASSISTANT_REPLY_KIND_OUTCOMES: readonly string[] = [
  'thought_saved_single',
  'thought_saved_many',
  'instruction_stored',
  'command_no_documents',
  'command_no_match',
  'command_executed',
  'multi_action_summary',
  'default',
] as const

/**
 * Top-level directories allowed directly under `skills/skill-classification/` (besides root `entry.md`).
 * - `decisions/` — classifier intents (`read`, `save`, …).
 * - `shared/` — everything else at this level (e.g. `auxiliary/` helpers), not classifier routing.
 */
export const CLASSIFICATION_BRANCH_TOP_LEVEL: readonly string[] = ['decisions', 'shared'] as const
