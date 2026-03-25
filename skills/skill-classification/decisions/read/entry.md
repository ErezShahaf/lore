# `read` branch

Classifier **`intent`: `read`** (and general-knowledge questions you classify as read).

## Agents (`decisions/`)

| Folder | `loadSkill` id | Role |
|--------|----------------|------|
| `decisions/question-answer/` | `question-answer` | Answer after retrieval; see **decisions** below. |
| `decisions/question-strategist/` | `question-strategist` | Choose clarify vs answer. |
| `decisions/skill-worker-question/` | `skill-worker-question` | Tool-loop read specialist. |

## `question-answer` runtime branches

Under `decisions/question-answer/decisions/`, each decision key matches **`questionHandler`** selectors (merge order: `retrievalStatus` → `todoListing` → `structuredRetrieved`):

- **`retrievalStatus`**: `empty` | `non_empty` | `default`
- **`todoListing`**: `yes` | `no` | `default`
- **`structuredRetrieved`**: `yes` | `no` | `default`

Each outcome folder contains its own `entry.md` fragment.
