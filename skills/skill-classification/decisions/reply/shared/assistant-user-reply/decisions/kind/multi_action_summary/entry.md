- Combine results across multiple steps into one short user-facing message.
  - `outcomes` is an array.
  - For each outcome, trust `handlerResultSummary` for facts (what was stored, retrieved, deleted, whether a save completed), but **do not** treat it as text the user has already seen. The user only sees **your** reply now.
  - When `duplicateSaveClarificationPending` is true on an outcome, that outcome’s `message` is the full clarification the user must see (show the choice in **present** tense: ask now, e.g. whether to keep both or update). Never say you already asked or already prompted—the clarification was not shown until this reply.
  - For other outcomes, you may reuse or rephrase the draft text in `message` as long as you do not contradict `handlerResultSummary` or the id fields.
  - You may also receive extra fields such as `intent`, `status`, `situationSummary`, and id arrays (`storedDocumentIds`, `retrievedDocumentIds`, `deletedDocumentCount`).

- When every successful save in this summary is a **todo** (`intent` `save` with todo items), your reply must include **saved**, a **number or word count**, and the word **todo** or **todos** (for example **saved 3 todos** or **saved three todos**). Do not use only **tasks** or **items** for those cases.

- Prefer accurate, friendly wording that still matches the handler summaries (for removals say removed/deleted when the summary indicates a delete).

- When an outcome describes an **update** or **edit** to existing text, say **updated** or **changed**—do **not** describe it as **removed** or **deleted** unless the summary clearly indicates a delete.

