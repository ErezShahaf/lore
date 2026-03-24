# Orchestrator and agents

## Main path (classification + handlers)

[`electron/services/agentService.ts`](../electron/services/agentService.ts) calls [`runMultiActionTurn`](../electron/services/multiActionOrchestrator.ts): unified classification produces an `actions` array; each action is executed in order by [`executeClassificationAction`](../electron/services/classificationActionExecutor.ts) (intent-specific handlers). Side-effect events (stored, retrieved, status, …) stream to the UI; outcomes (including touched document ids) are collected and passed to [`assistantReplyComposer`](../electron/services/assistantReplyComposer.ts) for a single turn-level user reply when needed.

## Alternate: tool-loop orchestrator (not wired from agentService)

[`electron/services/toolOrchestrator.ts`](../electron/services/toolOrchestrator.ts) implements an LLM-driven tool loop with [`orchestratorTools.ts`](../electron/services/orchestratorTools.ts). It is not the entry path used by `agentService` today.

## Deprecated: Classification-based orchestrator

[`electron/services/orchestratorService.ts`](../electron/services/orchestratorService.ts) is deprecated. Kept for potential rollback.

## Services used by the main multi-action path

| Step | Service / module |
|------|-------------------|
| Classify | `unifiedClassifierService` (`skill-classification`) |
| Per-action execution | `classificationActionExecutor` → thought / question / command / conversational handlers |
| Duplicate decision (save) | `duplicateResolutionService` |
| Turn reply (multi-action) | `assistantReplyComposer` (`assistant-user-reply`) |
| Question strategy / answer | `questionStrategistService`, `questionAnswerComposition`, `documentPipeline` |
| Command targets | `commandDecompositionService` |

## Legacy skills note

Older filenames mentioned in git history (`classification.md`, `question.md`, `save-decomposition.md`, `save-shape`, `save-items`) may still appear in docs or dist; the live classifier skill is `skill-classification.md`.
