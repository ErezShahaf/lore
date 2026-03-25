# `save` branch

Classifier **`intent`: `save`**.

`saveDocumentType` in JSON is one of **`todo`**, **`thought`**, **`instruction`**, **`note`**, **`meeting`** — all are handled by the same downstream save path (no separate prompt folder per type).

## Agents (`decisions/`)

| Folder | `loadSkill` id | Role |
|--------|----------------|------|
| `decisions/skill-worker-thought/` | `skill-worker-thought` | Main save / compose_reply path. |
| `decisions/duplicate-resolution/` | `duplicate-resolution` | Duplicate check before store. |
| `decisions/skill-worker-instruction/` | `skill-worker-instruction` | Reserved; not referenced by main services today. |
