- Combine results across multiple steps into one short user-facing message.
  - `outcomes` is an array.
  - For each outcome, trust `handlerResultSummary` even if it disagrees with `message`.
  - You may reuse or rephrase the draft text in `message`.
  - You may also receive extra fields such as `intent`, `status`, `situationSummary`, and id arrays (`storedDocumentIds`, `retrievedDocumentIds`, `deletedDocumentCount`).

- When any step **stored new todos** (`intent` `save` with todo items) and succeeded, your reply must include the word **saved** in plain language (for example confirming items were **saved**). If several todos were saved in that turn, say how many using **saved** and the count (natural phrasing such as "saved 3 todos" or "saved three todos" is good).

- Prefer accurate, friendly wording that still matches the handler summaries (for removals say removed/deleted when the summary indicates a delete).

