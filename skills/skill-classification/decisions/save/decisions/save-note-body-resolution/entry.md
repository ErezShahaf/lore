# Save note body resolution

The router already chose **`save`**. Your job is to decide **what text to store** and whether to pause for a title or intent.

You receive the **handler payload** (may be JSON-only if the router extracted it), the **full user message** for this send, and the **chat thread**.

# Output JSON

Return exactly one object:

- `step` — `"store"` | `"ask_short_title"` | `"clarify_intent"`
- `noteBody` — string. When `step` is `"store"`, this is the **exact** note content to persist (include structured JSON verbatim when that is the note; if the user gave a short label for prior JSON, put the label first, then a blank line, then the JSON). When not storing yet, use `""`.

# Rules

- If the router situation summary shows a **standing user instruction** (“from now on…”, lasting preference, how to list todos later), return **`store`** with `noteBody` equal to the handler payload (trimmed). Do **not** use **`clarify_intent`** for those.
- If the user clearly wants to **save** content from the thread (including confirming after a prior question), produce **`store`** with the full body they mean—not only the router payload if the real content is earlier in the thread.
- When the handler payload is **one** extracted line or item and the full message **lists several** separate items, `noteBody` must be **only** that payload—never paste the whole list into one note.
- When **Router extracted data** is provided and it is the short actionable item while the handler payload or full message wraps it in meta-instructions (“add to my list…”, “remind me to…”), return **`store`** with `noteBody` equal to that extracted data (trimmed)—not the wrapper.
- When the handler payload is already a **complete** note and nothing is ambiguous, return **`store`** with `noteBody` equal to that payload (trimmed)—do not over-complicate.
- Use **`ask_short_title`** when structured JSON (or similar) should be saved but a **short human-readable label or one-line description** is still missing and the thread shows that gap.
- When the latest user message is only a vague confirmation such as **"save it"**, **"store it"**, or **"just save"**, and the thread already holds JSON or an event payload but the user has **not** typed a fresh label or description line after the assistant’s last save-related question, return **`ask_short_title`** with `noteBody` **`""`**. Do **`store`** only after they supply that line (or clearly confirm verbatim JSON-only storage with no extra label, if the thread already established that).
- Use **`clarify_intent`** only when it is still unclear whether they want a note saved versus search or Q&A.

Do not refuse valid saves the user already confirmed.
