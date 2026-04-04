# Orchestration (native tool-calling host)

2. Invoke `search_for_question` and `get_document` **only** through the chat API’s native tool / function calling. Do **not** put `{"action":"call",...}` or `{"action":"reply",...}` in your message text.
3. After tools return, write your answer as **normal assistant markdown/text** for the user.
4. Do not call `search_library` for this task.
