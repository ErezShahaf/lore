<system_prompt id="classifier-repository-tree">

<role>
Reference map from classifier `intent` to on-disk prompt paths (for authors; model uses for orientation only).
</role>

<logic_flow>
1. LOAD ORDER: `skill-classification/entry.md`, then all `shared/first-turn-classifier/*.md` files lexicographically, joined with horizontal rules.
2. DISK SHAPE: Each node: `entry.md`, optional `decisions/`, optional `shared/`. Classifier intents under `decisions/`. Helpers under `shared/` (e.g. `shared/auxiliary/`)—classifier does not emit `auxiliary` intent.
3. INTENT → FOLDER: `read` → `decisions/read/`; `save` → `decisions/save/`; `edit`|`delete` → `decisions/command/`; `speak` → `decisions/speak/`. Cross-cutting: `decisions/reply/`, `decisions/shared/`.
</logic_flow>

<constraints>
- `saveDocumentType` for `save`: `todo`, `thought`, `instruction`, `note`, `meeting`.
- Alignment: `shared/skillTreeSpec.ts` and repo tests for disk layout.
</constraints>

<formatting_rules>
| `intent` (per action) | Folder |
|------------------------|--------|
| `read` | `decisions/read/` |
| `save` | `decisions/save/` |
| `edit` or `delete` | `decisions/command/` |
| `speak` | `decisions/speak/` |

| Path | Loader id(s) | Notes |
|------|----------------|--------|
| `decisions/read/entry.md` | _(branch)_ | Nested agents under `decisions/read/decisions/`. |
| `decisions/read/decisions/question-answer/` | `question-answer` | `retrievalStatus`, `todoListing`, `structuredRetrieved`. |
| `decisions/read/decisions/question-strategist/` | `question-strategist` | |
| `decisions/read/decisions/skill-worker-question/` | `skill-worker-question` | |
| `decisions/save/entry.md` | _(branch)_ | |
| `decisions/save/decisions/skill-worker-thought/` | `skill-worker-thought` | |
| `decisions/save/decisions/duplicate-resolution/` | `duplicate-resolution` | |
| `decisions/save/decisions/duplicate-prompt-follow-up/` | `duplicate-prompt-follow-up` | |
| `decisions/save/decisions/save-note-body-resolution/` | `save-note-body-resolution` | |
| `decisions/save/decisions/skill-worker-instruction/` | `skill-worker-instruction` | |
| `decisions/command/entry.md` | _(branch)_ | |
| `decisions/command/decisions/command-decomposition/` | `command-decomposition` | |
| `decisions/command/decisions/skill-worker-command/` | `skill-worker-command` | |
| `decisions/speak/entry.md` | _(branch)_ | |
| `decisions/speak/shared/skill-worker-conversational/` | `skill-worker-conversational` | |
| `decisions/reply/entry.md` | _(branch)_ | |
| `decisions/reply/shared/assistant-user-reply/` | `assistant-user-reply` | `decisions/kind/`. |
| `decisions/shared/entry.md` | _(branch)_ | |
| `decisions/shared/shared/skill-shared-protocol/` | `skill-shared-protocol` | |
| `shared/auxiliary/entry.md` | _(helpers)_ | |
| `shared/auxiliary/decisions/situation/` | `situation` | |
| `shared/auxiliary/decisions/intent-route/` | `intent-route` | |
| `shared/auxiliary/decisions/metadata-extraction/` | `metadata-extraction` | |
| `shared/auxiliary/decisions/orchestrator-low-confidence/` | `orchestrator-low-confidence` | |
</formatting_rules>

</system_prompt>
