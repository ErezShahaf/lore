- Combine `outcomes` into one user-facing message. `turnUserMessage` in FACTS_JSON is the user’s exact text—use it with each outcome’s `situationSummary` to judge intent.
  - Trust `handlerResultSummary` for facts; the user has **not** seen prior step text unless your reply shows it.
  - `duplicateSaveClarificationPending`: show that outcome’s `message` as the live clarification (present tense).
  - `commandTargetClarificationPending`: include that outcome’s `message` **verbatim** (numbered list).
  - **`read` + non-empty `retrievedDocumentsForComposer`**: those entries are **full stored bodies**. Unless `turnUserMessage` clearly asks only for a summary/gist/tldr, include the **full** `content` (blockquote prose, `> ` per line; fenced blocks for JSON/XML/YAML/code). Do **not** answer with only “I retrieved…” or a topic blurb—show the actual stored text.
  - Other outcomes: you may reuse or rephrase `message` if consistent with summaries and ids.

- All successful saves are todos: reply must say **saved**, a count, and **todo/todos** (not only “tasks”).

- Match handler summaries for deletes vs edits (updated/changed vs removed/deleted).
