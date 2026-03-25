# `edit` / `delete` branch

Classifier **`intent`: `edit`** or **`delete`** — both use this **`decisions/command/`** tree (same agents).

## Agents (`decisions/`)

| Folder | `loadSkill` id | Role |
|--------|----------------|------|
| `decisions/command-decomposition/` | `command-decomposition` | Resolve targets / planning. |
| `decisions/skill-worker-command/` | `skill-worker-command` | Tool-loop update specialist. |
