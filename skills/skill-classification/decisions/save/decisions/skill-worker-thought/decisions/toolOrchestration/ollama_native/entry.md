# Orchestration (native tool-calling host)

For step 1 when you must ask the user (no save tools): reply in **plain assistant text**—do not use `{"action":"reply",...}`.

Use `save_documents`, `get_document`, and `compose_reply` **only** via the API’s native tool calling. Do not type `{"action":"call",...}` in your message body.

After `compose_reply` returns, your **next** assistant message **content** must be **exactly** that tool’s text (plain user-visible wording, not wrapped in JSON).
