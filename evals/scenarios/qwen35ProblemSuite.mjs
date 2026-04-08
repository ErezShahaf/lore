/**
 * Scenarios that failed at least once for Ollama model qwen3.5:9b (classic classify_handlers path).
 *
 * Source: evals/results/promptfoo-full-2026-04-05T16-59-50-242Z.json
 *
 * Re-run: npm run eval:promptfoo -- --suite qwen35-problem --models qwen3.5:9b
 *
 * To refresh this list after a new full eval, union scenario ids from results.results
 * where provider.label includes qwen3.5:9b and success is false.
 */
export const qwen35ProblemSuiteName = 'qwen35-problem'

export const qwen35ProblemScenarioIds = [
  'ambiguous-delete-needs-clarification',
  'ambiguous-delete-then-what-are-options-lists-real-todos',
  'ambiguous-ride-completion-follow-up-selects-motorcycle',
  'ambiguous-ride-completion-needs-clarification',
  'ambiguous-ride-completion-numeric-follow-up-executes',
  'ambiguous-ride-edit-follow-up-updates-target',
  'ambiguous-run-completion-needs-clarification',
  'ambiguous-run-completion-numeric-follow-up-executes',
  'ambiguous-run-delete-exact-content-follow-up-executes',
  'ambiguous-running-todos-delete-needs-clarification',
  'ambiguous-ten-times-completion-all-follow-up-removes-four',
  'ambiguous-ten-times-completion-offers-all-option',
  'ambiguous-update-needs-clarification',
  'ambiguous-water-delete-repair-after-correction',
  'canonical-json-duplicate-detects-reordered-keys',
  'change-word-text-substitution-not-unit-conversion',
  'clarification-resolves-ambiguous-delete',
  'clarification-resolves-ambiguous-update',
  'cross-provider-webhook-request-needs-provider-clarification',
  'delete-todos-when-completion-mentions-listed-items',
  'delete-with-wrong-distance-clarifies-not-silent-wrong-todo',
  'duplicate-prompt-then-add-new-keeps-two-rows',
  'identical-todo-repeat-clarifies-before-second-copy',
  'generic-stripe-webhook-url-needs-event-clarification',
  'heuristic-trap-todo-text-contains-remember-and-list-all-dialogue',
  'identical-thought-twice-surfaces-duplicate-handling',
  'instruction-does-not-leak-into-unrelated-note-answer',
  'instruction-greeting-trigger-can-show-todos',
  'instruction-lists-todos-newest-first',
  'instruction-plus-json-saves-on-first-turn',
  'large-corpus-ambiguous-atlas-reference-needs-clarification',
  'large-corpus-specific-url-retrieval-stays-focused',
  'large-corpus-story-ending-retrieval-by-description',
  'large-corpus-webhook-retry-guide-stays-focused',
  'large-event-json-without-save-wording-clarifies',
  'low-confidence-vague-request',
  'raw-json-then-store-it-saves-json-not-other-content',
  'restaurant-json-clarify-then-save-preserves-json',
  'restaurant-json-title-follow-up-embeds-json-body',
  'seeded-ambiguous-retrieval-clarification-resolves',
  'seeded-ambiguous-retrieval-needs-clarification',
  'seeded-large-db-targeted-retrieval',
  'seeded-retrieval-threshold-discipline',
  'specific-structured-json-request-picks-the-right-stripe-event',
  'stripe-checkout-webhook-url-by-paraphrase',
  'stripe-payment-failed-webhook-url-by-different-phrasing',
]
