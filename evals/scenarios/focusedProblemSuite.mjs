/**
 * Focused problem suite: one representative scenario per failure category.
 *
 * Run with: npm run eval:promptfoo -- --suite focused-problem --repeat 1 --models qwen3.5:9b
 */
export const focusedProblemSuiteName = 'focused-problem'

export const focusedProblemScenarioIds = [
  'retrieve-todos-with-casual-phrasing',
  'instruction-coexists-with-todo-creation',
  'heuristic-trap-capture-note-ends-with-question-mark',
  'seeded-ambiguous-retrieval-needs-clarification',
  'stripe-checkout-webhook-url-by-paraphrase',
  'raw-json-then-store-it-saves-json-not-other-content',
  'duplicate-prompt-then-add-new-keeps-two-rows',
  'change-word-text-substitution-not-unit-conversion',
  'large-corpus-story-ending-retrieval-by-description',
  'low-confidence-vague-request',
]
