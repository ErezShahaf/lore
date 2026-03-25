# `read` branch

Classifier **`intent`: `read`** (and general-knowledge questions you classify as read).

## Agents (subfolders)

| Folder | `loadSkill` id | Role |
|--------|----------------|------|
| `question-answer/` | `question-answer` | Answer after retrieval; see **forks** below. |
| `question-strategist/` | `question-strategist` | Choose clarify vs answer. |
| `skill-worker-question/` | `skill-worker-question` | Tool-loop read specialist. |

## `question-answer` runtime branches

Under `question-answer/forks/`, each decision key matches **`questionHandler`** selectors (merge order: `retrievalStatus` → `todoListing` → `structuredRetrieved`):

- **`retrievalStatus`**: `empty` | `non_empty` | `default`
- **`todoListing`**: `yes` | `no` | `default`
- **`structuredRetrieved`**: `yes` | `no` | `default`

Each outcome folder contains its own `entry.md` fragment.
