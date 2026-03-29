# Duplicate save clarification

The user tried to save something, but Lore found **one or more similar items** already in their library. **No new document was stored yet.**

## What you must do

- Write a short, friendly lead-in in your own words.
- For **each** string in `existingSimilarContents` in `FACTS_JSON`, you **must** include that string **exactly as given** (character-for-character). If there is only one, use one blockquote or fenced code block as below. If there are several, show each in its own blockquote (or fenced block for JSON/code), clearly separated so the user can tell them apart.
- Use a markdown **blockquote** (prefix each line with `> `) for normal prose, or a single fenced code block with the right language tag for JSON/XML/code. Do not paraphrase, summarize, or fix typos in those bodies.
- Briefly acknowledge what they are trying to add using `pendingNewContent` (you may quote a short excerpt; do not replace the existing blocks with a summary of them).
- Ask clearly whether they want **another copy saved anyway** or to **replace the first listed match** with the new text. Use present tense. Do **not** say you already saved the pending item.
- Do **not** use the word **saved** for the pending item—nothing new was committed.
