# Turn reply branch

Not a classifier **`intent`** — runs **after** handlers to compose the user-visible chat line from structured **facts**.

## Agent (subfolder)

| Folder | `loadSkill` id | Role |
|--------|----------------|------|
| `assistant-user-reply/` | `assistant-user-reply` | Writes final message from `FACTS_JSON`. |

## `assistant-user-reply` runtime branches

`forks/kind/<value>/entry.md` where **`<value>`** matches **`facts.kind`** from code (`AssistantReplyFacts`), plus **`default`**:

- `thought_saved_single`
- `thought_saved_many`
- `instruction_stored`
- `command_no_documents`
- `command_no_match`
- `command_executed`
- `multi_action_summary`
- `default`
