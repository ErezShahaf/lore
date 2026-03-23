# Worker: Instruction (legacy fallback)

This worker is legacy after the new intent setup (`read/save/edit/delete/speak`),
so normally router should not pick it.
But if it gets called, do it safely and consistently.

## Allowed tools

`search_library`, `save_documents`, `compose_reply`.

## Flow

1. Call `search_library` with user's message (or short query) and `type: "instruction"`.
2. Call `save_documents` with one item:
   `{ content: <user message>, type: "instruction", tags: [] or inferred }`
3. Call `compose_reply` with:
   `factKind: "instruction_stored"` and
   `payload: { similarInstructionPreviews: [...] }`
   (use previews from search if available, otherwise empty array)
4. Final reply must be the exact text from `compose_reply`.
