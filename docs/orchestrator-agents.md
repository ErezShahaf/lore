# Orchestrator and agents

## Main path (classification + handlers)

[`electron/services/agentService.ts`](../electron/services/agentService.ts) calls [`runMultiActionTurn`](../electron/services/multiActionOrchestrator.ts): unified classification produces an `actions` array; each action is executed in order by [`executeClassificationAction`](../electron/services/classificationActionExecutor.ts) (intent-specific handlers). Side-effect events (stored, retrieved, status, …) stream to the UI; outcomes (including touched document ids) are collected and passed to [`assistantReplyComposer`](../electron/services/assistantReplyComposer.ts) for a single turn-level user reply when needed.

## Alternate: tool-loop orchestrator (not wired from agentService)

[`electron/services/toolOrchestrator.ts`](../electron/services/toolOrchestrator.ts) implements an LLM-driven tool loop with [`orchestratorTools.ts`](../electron/services/orchestratorTools.ts). It is not the entry path used by `agentService` today.

## Deprecated: Classification-based orchestrator

[`electron/services/orchestratorService.ts`](../electron/services/orchestratorService.ts) is deprecated. Kept for potential rollback.

## Skill prompts on disk

All prompts live under **`skills/skill-classification/`**: the root **`entry.md`** is the unified classifier only. Subfolders mirror routing — **`read/`**, **`save/`**, **`command/`** (for both **`edit`** and **`delete`**), **`speak/`**, plus **`reply/`**, **`shared/`**, **`auxiliary/`**. Each branch has an **`entry.md`** describing its children; agent folders have their own **`entry.md`** and optional **`forks/<decision>/<outcome>/`** trees. `loadSkill` still uses the same logical ids (for example `question-answer`); the loader resolves them under this tree and prepends ancestor branch **`entry.md`** fragments. Mount paths and fork outcomes are defined in **[`shared/skillTreeSpec.ts`](../shared/skillTreeSpec.ts)**; **`npm test`** runs [`electron/services/skillTreeAlignment.test.ts`](../electron/services/skillTreeAlignment.test.ts) to ensure the folder tree stays aligned.

## Services used by the main multi-action path

| Step | Service / module |
|------|-------------------|
| Classify | `unifiedClassifierService` → `loadSkill(FIRST_TURN_SKILL_ID)` → `skills/skill-classification/entry.md` (root only; no subtree) |
| Per-action execution | `classificationActionExecutor` → thought / question / command / conversational handlers |
| Duplicate decision (save) | `duplicateResolutionService` |
| Turn reply (multi-action) | `assistantReplyComposer` → `skills/skill-classification/reply/assistant-user-reply/` |
| Question strategy / answer | `questionStrategistService`, `questionAnswerComposition`, `documentPipeline` |
| Command targets | `commandDecompositionService` |

## Legacy skills note

Older filenames mentioned in git history (`classification.md`, `question.md`, `save-decomposition.md`, `save-shape`, `save-items`) may still appear in docs or dist; the live classifier prompt is `skills/skill-classification/entry.md` (skill id `skill-classification` in code).
