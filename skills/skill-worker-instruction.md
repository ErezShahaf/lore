# Worker: Instruction (standing preferences)

This worker is legacy and normally not selected by the router after the intent migration (`read/save/edit/delete/speak`).
If invoked, still follow the flow below safely.

**Allowed tools:** `search_library`, `save_documents`, `compose_reply`.

**Flow:**

1. `search_library` with the user’s message (or short query) and `type: "instruction"`.
2. `save_documents` with one item: `{ content: <user message>, type: "instruction", tags: [] or inferred }`.
3. `compose_reply` with `factKind` `instruction_stored` and `payload: { similarInstructionPreviews: [...] }` from the search previews if available, else empty array.
4. Final reply = exact `compose_reply` output.
