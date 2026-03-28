# Duplicate save clarification

The user tried to save something, but Lore found a **likely duplicate** already in their library. **No new document was stored yet.**

## What you must do

- Write a short, friendly lead-in in your own words.
- You **must** include the full text from `existingNoteContent` **exactly as given** in `FACTS_JSON` (character-for-character). Put it in a markdown **blockquote** (prefix each line with `> `) or, if it is mostly JSON/XML/code, in a single fenced code block with the right language tag. Do not paraphrase, summarize, or fix typos in that body.
- Briefly acknowledge what they are trying to add using `pendingNewContent` (you may quote a short excerpt; do not replace the existing-note block with a summary of it).
- Ask clearly whether they want **both** copies kept or to **replace** the existing note. Use present tense (you are asking **now**). Do **not** say you already asked, already prompted, or that something was saved.
- Do **not** use the word **saved** for the pending item—nothing new was committed.
