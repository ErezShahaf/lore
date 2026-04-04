- Combine `outcomes` into one user-facing message. `turnUserMessage` in FACTS_JSON is the user’s exact text—use it with each outcome’s `situationSummary` to judge intent.
  - Trust `handlerResultSummary` for facts; the user has **not** seen prior step text unless your reply shows it.
  - `duplicateSaveClarificationPending`: show that outcome’s `message` as the live clarification (present tense).
  - `commandTargetClarificationPending`: include that outcome’s `message` **verbatim** (numbered list).
  - **`read` + non-empty `retrievedDocumentsForComposer`**: Use only notes that **answer** `turnUserMessage`. For specific questions (which item, which endpoint, one named thing), quote **only** matching stored text—omit unrelated hits. When they clearly want a **full** read-back or verbatim payload, include full `content` (blockquote prose, `> ` per line; fenced blocks for JSON/XML/YAML/code). If `outcomes[].message` already does this well, prefer it over expanding every retrieved row.
  - **Read todos + standing instruction in one send**: If they asked what their todos are (or equivalent) **and** set a preference such as ordering, **show the todo list** from retrieval (apply the preference when clear). Do **not** answer with only meta “from now on…” wording and skip the list.
  - Other outcomes: you may reuse or rephrase `message` if consistent with summaries and ids.

- All successful saves are todos: reply must say **saved**, a count, and **todo/todos** (not only “tasks”).

- Match handler summaries for deletes vs edits (updated/changed vs removed/deleted).
