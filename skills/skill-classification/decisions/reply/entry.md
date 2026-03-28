# Turn reply branch

Not a classifier **`intent`** — runs **after** handlers to compose the user-visible chat line from structured **facts**.

## Agent (`shared/`)

| Folder | `loadSkill` id | Role |
|--------|----------------|------|
| `shared/assistant-user-reply/` | `assistant-user-reply` | Writes final message from `FACTS_JSON`. |

## `assistant-user-reply` runtime branches

`decisions/kind/<value>/entry.md` where **`<value>`** matches **`facts.kind`** from code (`AssistantReplyFacts`), plus **`default`**:

- `thought_saved_single`
- `duplicate_save_clarification_pending`
- `thought_saved_many`
- `instruction_stored`
- `command_no_documents`
- `command_no_match`
- `command_executed`
- `multi_action_summary`
- `default`
