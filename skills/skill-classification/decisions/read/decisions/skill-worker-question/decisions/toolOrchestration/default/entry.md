# Orchestration (JSON-in-text host)

The host expects each assistant step as **exactly one JSON object** (no markdown around it).

2. Use `{"action":"call","agent":"search_for_question","params":{...}}` (and `get_document` if needed) for tools.
3. After retrieval, answer the user with `{"action":"reply","content":"..."}`.
4. Do not call `search_library` for this task.
