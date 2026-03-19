# Promptfoo Summary

Result file: `R:\lore\evals\results\promptfoo-full-2026-03-19T22-35-07-255Z.json`

## [qwen3.5:9b] smalltalk-random-question-then-add

Random smalltalk before action

Pass rate: 1/3 (33.3%)

Failure stages:
- 2x Step 2 @ No status emitted

Failure reasons:
- 1x Step 2: expected 1 todos but found 0.
- 1x Step 2: expected a todo containing "buy new headphones".
- 1x Step 2: expected 1 stored events but saw 2.

Failed check types:
- 1x todoCount
- 1x todoContentsIncludeSubstrings
- 1x storedCount

Sample failures:
    Sample failed checks:
      - todoCount: expected 1 todos but found 0.
        expected: 1
        actual: 0
      - todoContentsIncludeSubstrings: expected a todo containing "buy new headphones".
        expected: buy new headphones
        actual: []
    Attempted conversation:
      - user: Anyway, add to my todo list: buy new headphones
        assistant: Got it! I've saved your thought about Anyway, add to my todo list:....
    Sample failed checks:
      - storedCount: expected 1 stored events but saw 2.
        expected: 1
        actual: 2
    Attempted conversation:
      - user: Anyway, add to my todo list: buy new headphones
        assistant: Got it! I've saved 2 todos.

## [qwen3.5:9b] add-single-todo-variant-phrasing

Add a todo with alternate phrasing

Pass rate: 2/3 (66.7%)

Failure stages:
- 1x Step 1 @ No status emitted

Failure reasons:
- 1x Step 1: expected 1 todos but found 0.
- 1x Step 1: expected a todo containing "call mom".

Failed check types:
- 1x todoCount
- 1x todoContentsIncludeSubstrings

Sample failures:
    Sample failed checks:
      - todoCount: expected 1 todos but found 0.
        expected: 1
        actual: 0
      - todoContentsIncludeSubstrings: expected a todo containing "call mom".
        expected: call mom
        actual: []
    Attempted conversation:
      - user: Please put "call mom" on my todo list.
        assistant: Got it! I've saved your thought about Please put "call mom" on my....

## [qwen3.5:9b] clarification-resolves-ambiguous-update

Clarification follow-up resolves the right todo

Pass rate: 2/3 (66.7%)

Failure stages:
- 1x Step 2 @ No status emitted

Failure reasons:
- 1x Step 2: did not expect todo "drink the water" to exist.
- 1x Step 2: expected a todo containing "drink the fire".

Failed check types:
- 1x todoContentsExcludeExact
- 1x todoContentsIncludeSubstrings

Sample failures:
    Sample failed checks:
      - todoContentsExcludeExact: did not expect todo "drink the water" to exist.
        expected: Todo list must exclude "drink the water"
        actual: [
  "jump on the water",
  "drink the water"
]
      - todoContentsIncludeSubstrings: expected a todo containing "drink the fire".
        expected: drink the fire
        actual: undefined
    Attempted conversation:
      - user: Edit the water to fire
        assistant: I'm not confident about this: "Update both water-related todos to 'fire the water' as another interpretation of 'edit the water to fire'. Confidence is very low due to semantic ...

## [qwen3.5:9b] add-single-todo-explicit

Add a single explicit todo

Pass rate: 3/3 (100.0%)

## [qwen3.5:9b] add-multiple-todos-inline-list

Add multiple todos in one message

Pass rate: 3/3 (100.0%)

## [qwen3.5:9b] add-multiple-todos-multiline

Add todos from a multiline list

Pass rate: 3/3 (100.0%)

## [qwen3.5:9b] ambiguous-delete-needs-clarification

Ambiguous delete does not act immediately

Pass rate: 3/3 (100.0%)

## [qwen3.5:9b] ambiguous-update-needs-clarification

Ambiguous update asks for clarification

Pass rate: 3/3 (100.0%)

## [qwen3.5:9b] clarification-resolves-ambiguous-delete

Clarification follow-up deletes the intended todo

Pass rate: 3/3 (100.0%)

## [qwen3.5:9b] delete-specific-todo

Delete one matching todo

Pass rate: 3/3 (100.0%)

## [qwen3.5:9b] explicit-edit-similar-todos

Explicit edit of one similar todo

Pass rate: 3/3 (100.0%)

## [qwen3.5:9b] pure-greeting-does-not-store

Greeting alone does not create data

Pass rate: 3/3 (100.0%)

## [qwen3.5:9b] greeting-then-add-todo

Greeting before task creation

Pass rate: 3/3 (100.0%)

## [qwen3.5:9b] instruction-does-not-become-todo

Instruction stays separate from todos

Pass rate: 3/3 (100.0%)

## [qwen3.5:9b] duplicate-todo-still-persists-separately

Near-duplicate todo requests still store separately

Pass rate: 3/3 (100.0%)

## [qwen3.5:9b] seeded-large-db-targeted-retrieval

Retrieve the right fact from seeded large data

Pass rate: 3/3 (100.0%)

## [qwen3.5:9b] retrieve-todos-after-creation

Retrieve todos after creating them

Pass rate: 3/3 (100.0%)

## [qwen3.5:9b] retrieve-todos-with-casual-phrasing

Retrieve todos with casual wording

Pass rate: 3/3 (100.0%)

## [qwen3.5:9b] seeded-ambiguous-retrieval-needs-clarification

Seeded retrieval ambiguity asks for clarification

Pass rate: 3/3 (100.0%)

## [qwen3.5:9b] seeded-ambiguous-retrieval-clarification-resolves

Seeded retrieval clarification leads to the right Alex

Pass rate: 3/3 (100.0%)

## [qwen3.5:9b] seeded-retrieval-threshold-discipline

Seeded retrieval keeps the result set focused

Pass rate: 3/3 (100.0%)

## [qwen3.5:9b] update-specific-todo

Update a specific todo by description

Pass rate: 3/3 (100.0%)

## [qwen3.5:9b] low-confidence-vague-request

Vague request does not mutate state

Pass rate: 3/3 (100.0%)
