# Orchestration (JSON-in-text host)

The host expects **exactly one JSON object** per assistant step.

- Tool steps: `{"action":"call","agent":"<tool_name>","params":{...}}`.
- When you have the user-facing text from `compose_reply` (or a clarification you write yourself), send it as `{"action":"reply","content":"..."}`.

Your final visible message must match that JSON reply shape with the exact `compose_reply` string when that tool was used.
