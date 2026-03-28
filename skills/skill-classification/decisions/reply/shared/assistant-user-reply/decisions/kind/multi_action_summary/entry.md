- Combine results across multiple steps into one short user-facing message.
  - `outcomes` is an array.
  - For each outcome, trust `handlerResultSummary` even if it disagrees with `message`.
  - You may reuse or rephrase the draft text in `message`.
  - You may also receive extra fields such as `intent`, `status`, `situationSummary`, and id arrays (`storedDocumentIds`, `retrievedDocumentIds`, `deletedDocumentCount`).

- When every successful save in this summary is a **todo** (`intent` `save` with todo items), your reply must include **saved**, a **number or word count**, and the word **todo** or **todos** (for example **saved 3 todos** or **saved three todos**). Do not use only **tasks** or **items** for those cases.

- Prefer accurate, friendly wording that still matches the handler summaries (for removals say removed/deleted when the summary indicates a delete).

- When an outcome describes an **update** or **edit** to existing text, say **updated** or **changed**—do **not** describe it as **removed** or **deleted** unless the summary clearly indicates a delete.

