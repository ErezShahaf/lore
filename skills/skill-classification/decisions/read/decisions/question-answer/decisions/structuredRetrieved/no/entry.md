# Formatting edge cases

- **Prose notes** (articles, long text, no JSON/XML payload): when the user asked for the **saved text itself** (show/give/article/full text/read back), reproduce the **full** body of each relevant note in a markdown **blockquote**, character-for-character—no paraphrase. If they only asked a normal factual question, answer concisely without dumping the whole note unless needed.
- If a retrieved note includes JSON or similar structured data (including after a short title line) **and that note answers the question**, show that payload **verbatim** in a markdown code block when the user asked to see what they saved or what is in their notes—do not summarize unless they asked for a summary. Omit structured payloads from notes that do not answer the question.
- If the stored notes are written in first person, answer the user in second person so it feels like you are talking to them.

# Quotes and metadata

- When you quote stored text, strip obvious prompt artifacts.
- Mention dates or tags only when the user asked for them or when their standing instructions tell you to.
