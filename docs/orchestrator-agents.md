# Orchestrator and agents

## Main path (classification + handlers)

[`electron/services/agentService.ts`](../electron/services/agentService.ts) calls [`runMultiActionTurn`](../electron/services/multiActionOrchestrator.ts): unified classification produces an `actions` array; each action is executed in order by [`executeClassificationAction`](../electron/services/classificationActionExecutor.ts) (intent-specific handlers). Side-effect events (stored, retrieved, status, …) stream to the UI; outcomes (including touched document ids) are collected and passed to [`assistantReplyComposer`](../electron/services/assistantReplyComposer.ts) for a single turn-level user reply when needed.

## Native tool loop (settings: `native_tool_loop`)

When [`agentService`](../electron/services/agentService.ts) uses **`native_tool_loop`**, [`runNativeToolLoopTurn`](../electron/services/turnEngine.ts) runs **without** the upfront unified classifier. The model uses a single composed prompt from [`skill-native-unified-agent`](../skills/skill-classification/decisions/shared/shared/skill-native-unified-agent/entry.md) plus [`skill-shared-protocol`](../skills/skill-classification/decisions/shared/shared/skill-shared-protocol/entry.md), with tools for read, save, command, and optional [`summarize_context`](../electron/services/orchestratorTools.ts)—**not** `compose_reply`; the same model drafts final user text from tool JSON. Tool results are labeled as untrusted data when fed back into the loop. The only nested LLM inside a native-loop tool is `summarize_context` (context compression). Classic `classify_handlers` still uses [`assistantReplyComposer`](../electron/services/assistantReplyComposer.ts) and worker paths that may call `compose_reply` where applicable.

## Routed JSON tool loop (experimental / alternate host)

[`electron/services/toolOrchestrator.ts`](../electron/services/toolOrchestrator.ts) implements an LLM-driven tool loop that still **classifies first** via [`resolveWorkerForTurn`](../electron/services/workerRouter.ts), then restricts tools per worker kind. It is a separate entry path from `agentService`’s native loop.

## Deprecated: Classification-based orchestrator

[`electron/services/orchestratorService.ts`](../electron/services/orchestratorService.ts) is deprecated. Kept for potential rollback.

## Skill prompts on disk

All prompts live under **`skills/skill-classification/`**: the root **`entry.md`** is the unified classifier only. **Classifier** intents sit under **`decisions/`** (`read`, `save`, `command`, `speak`, plus pipeline branches **`reply/`** and **`shared/`**). Everything else at the repository root of that tree is under **`shared/`** (for example **`shared/auxiliary/`** for situation extraction, routing hints, metadata, and similar—not classifier outputs). Each node may repeat **`entry.md`**, **`decisions/`**, and **`shared/`**. `loadSkill` ids are unchanged; paths are in **[`shared/skillTreeSpec.ts`](../shared/skillTreeSpec.ts)**. **`npm test`** runs [`electron/services/skillTreeAlignment.test.ts`](../electron/services/skillTreeAlignment.test.ts) to keep the tree aligned.

## Services used by the main multi-action path

| Step | Service / module |
|------|-------------------|
| Classify | `unifiedClassifierService` → `loadSkill(FIRST_TURN_SKILL_ID)` → `skills/skill-classification/entry.md` (root only; no subtree) |
| Per-action execution | `classificationActionExecutor` → thought / question / command / conversational handlers |
| Duplicate decision (save) | `duplicateResolutionService` |
| Turn reply (multi-action) | `assistantReplyComposer` → `skills/skill-classification/decisions/reply/shared/assistant-user-reply/` |
| Question strategy / answer | `questionStrategistService`, `questionAnswerComposition`, `documentPipeline` |
| Command targets | `commandDecompositionService` |

## Legacy skills note

Older filenames mentioned in git history (`classification.md`, `question.md`, `save-decomposition.md`, `save-shape`, `save-items`) may still appear in docs or dist; the live classifier prompt is `skills/skill-classification/entry.md` (skill id `skill-classification` in code).
