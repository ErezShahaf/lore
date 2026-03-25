# `save` branch

Classifier **`intent`: `save`**.

`saveDocumentType` in JSON is one of **`todo`**, **`thought`**, **`instruction`**, **`note`**, **`meeting`** — all are handled by the same downstream save path (no separate prompt folder per type).

## Agents (subfolders)

| Folder | `loadSkill` id | Role |
|--------|----------------|------|
| `skill-worker-thought/` | `skill-worker-thought` | Main save / compose_reply path. |
| `duplicate-resolution/` | `duplicate-resolution` | Duplicate check before store. |
| `skill-worker-instruction/` | `skill-worker-instruction` | Reserved; not referenced by main services today. |
