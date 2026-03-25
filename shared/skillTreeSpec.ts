/**
 * Single source of truth for skill directory layout under `skills/skill-classification/`.
 * Keep in sync with prompts in those folders; `skillTreeAlignment` tests enforce disk layout.
 */
export const SKILL_MOUNT_SEGMENTS: Readonly<Record<string, readonly string[]>> = {
  'question-answer': ['read', 'question-answer'],
  'question-strategist': ['read', 'question-strategist'],
  'skill-worker-question': ['read', 'skill-worker-question'],
  'skill-worker-thought': ['save', 'skill-worker-thought'],
  'duplicate-resolution': ['save', 'duplicate-resolution'],
  'skill-worker-instruction': ['save', 'skill-worker-instruction'],
  'command-decomposition': ['command', 'command-decomposition'],
  'skill-worker-command': ['command', 'skill-worker-command'],
  'skill-worker-conversational': ['speak', 'skill-worker-conversational'],
  'assistant-user-reply': ['reply', 'assistant-user-reply'],
  'skill-shared-protocol': ['shared', 'skill-shared-protocol'],
  'situation': ['auxiliary', 'situation'],
  'intent-route': ['auxiliary', 'intent-route'],
  'metadata-extraction': ['auxiliary', 'metadata-extraction'],
  'orchestrator-low-confidence': ['auxiliary', 'orchestrator-low-confidence'],
} as const

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

/** Top-level directories allowed directly under `skills/skill-classification/` (besides root `entry.md`). */
export const CLASSIFICATION_BRANCH_TOP_LEVEL: readonly string[] = [
  'read',
  'save',
  'command',
  'speak',
  'reply',
  'shared',
  'auxiliary',
] as const
