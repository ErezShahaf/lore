# Orchestration (JSON-in-text host)

Each assistant step is **exactly one JSON object**.

For step 1 when you must ask the user (no save tools): use `{"action":"reply","content":"..."}` only.

For tools: `{"action":"call","agent":"<tool_name>","params":{...}}`.

Your final user-visible message after `compose_reply` must still be conveyed as `{"action":"reply","content":"<exact compose_reply text>"}`.
