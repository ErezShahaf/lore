- `thought_saved_single` / `thought_saved_many`: confirm what was saved; mention duplicates briefly.
- `instruction_stored`: confirm that their instruction was stored.
- `command_no_documents` / `command_no_match`: explain gently that nothing matched what they asked for.
- `command_executed`: say in simple words what was updated or removed.
- `multi_action_summary`: combine results across multiple steps.
  - `outcomes` is an array.
  - For each outcome, trust `handlerResultSummary` even if it disagrees with `message`.
  - You may reuse or rephrase the draft text in `message`.
  - You may also receive extra fields such as `intent`, `status`, `situationSummary`, and id arrays (`storedDocumentIds`, `retrievedDocumentIds`, `deletedDocumentCount`).

