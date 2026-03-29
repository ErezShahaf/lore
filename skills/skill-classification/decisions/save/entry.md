# `save` branch

Classifier **`intent`: `save`**.

`saveDocumentType` in JSON is one of **`todo`**, **`thought`**, **`instruction`**, **`note`**, **`meeting`** — all are handled by the same downstream save path (no separate prompt folder per type).

## Agents (`decisions/`)

| Folder | `loadSkill` id | Role |
|--------|----------------|------|
| `decisions/skill-worker-thought/` | `skill-worker-thought` | Main save / compose_reply path. |
| `decisions/duplicate-resolution/` | `duplicate-resolution` | User intent after a likely duplicate (ask / add_new / update). |
| `decisions/duplicate-prompt-follow-up/` | `duplicate-prompt-follow-up` | Interpret user reply after duplicate add-new vs update prompt. |
| `decisions/save-note-body-resolution/` | `save-note-body-resolution` | Decide stored body vs title or intent clarification for save path. |
| `decisions/skill-worker-instruction/` | `skill-worker-instruction` | Reserved; not referenced by main services today. |
