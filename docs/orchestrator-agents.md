# Orchestrator and agents

## Orchestrator (code)

The **orchestrator** is implemented in [`electron/services/orchestratorService.ts`](../electron/services/orchestratorService.ts). It owns the per-turn loop (see `ORCHESTRATOR_MAX_STEPS` in [`shared/types.ts`](../shared/types.ts)), records which handler ran on `OrchestratorTurnResult.completedDispatcherIds`, and delegates to existing handlers without changing their internals.

[`electron/services/agentService.ts`](../electron/services/agentService.ts) is a thin wrapper: it updates session state from `OrchestratorTurnResult` after `runOrchestratedTurn` completes.

Future work: additional loop iterations after retrieval (e.g. empty results → clarify or re-route) without duplicating routing logic across handlers.

## Classification bundle (LLM, chained in classifier)

| Skill | Service |
|-------|---------|
| `situation.md` | `situationService.ts` |
| `intent-route.md` | `intentRouteService.ts` |
| `metadata-extraction.md` | `metadataExtractionService.ts` (includes thoughtClarification for bare data / suggest-description) |

## Thought path

| Skill | Service / handler |
|-------|-------------------|
| `save-shape.md` | `saveShapeService.ts` |
| `save-items.md` | `saveDecompositionService.ts` |

## Question path

| Skill | Service / handler |
|-------|-------------------|
| Retrieval | `documentPipeline` (code) |
| `question-strategist.md` | `questionStrategistService.ts` |
| `question-answer.md` | `questionHandler.ts` (stream) |

## Command path

| Skill | Service / handler |
|-------|-------------------|
| Retrieval | `commandHandler` + `documentPipeline` |
| `command-decomposition.md` | `commandDecompositionService.ts` |

## Instruction and conversational

| Skill | Handler |
|-------|---------|
| (none) | `instructionHandler.ts` — store only |
| `conversational.md` | `conversationalHandler.ts` |

When relevant instruction documents exist, conversational intent may route through `handleQuestion` (see orchestrator `QuestionHandlerViaInstructions`).

## Legacy skills (not loaded by the main path)

- `classification.md` — superseded by situation + intent-route + metadata-extraction
- `question.md` — superseded by question-strategist + question-answer
- `save-decomposition.md` — superseded by save-shape + save-items
