# Orchestrator and agents

## Orchestrator (code)

The **orchestrator** is an LLM agent that receives every user message first and decides what to do by calling tools one step at a time. Each tool call returns control to the orchestrator, which then chooses the next tool or returns to the user.

- **Main path**: [`electron/services/agentService.ts`](../electron/services/agentService.ts) calls [`runToolOrchestratedTurn`](../electron/services/toolOrchestrator.ts).
- **Tool definitions and handlers**: [`electron/services/orchestratorTools.ts`](../electron/services/orchestratorTools.ts) — classify_intent, search_for_question, decide_question_strategy, answer_from_documents, plan_save_shape, decompose_save_items, resolve_command_targets, compose_reply, draft_conversational_reply, plus the base document tools (search_library, get_document, save_documents, modify_documents).
- **Skill prompt**: [`skills/orchestrator-agent.md`](../skills/orchestrator-agent.md) describes the step-by-step workflows.

## Deprecated: Classification-based orchestrator

[`electron/services/orchestratorService.ts`](../electron/services/orchestratorService.ts) is deprecated. It used classification-based routing and single dispatch to handlers. Kept for potential rollback.

## Services used by orchestrator tools

| Tool | Service |
|------|---------|
| classify_intent | classifierService (situation + intent-route + metadata-extraction) |
| decide_question_strategy | questionStrategistService |
| answer_from_documents | questionAnswerComposition, documentPipeline |
| plan_save_shape | saveShapeService |
| decompose_save_items | saveDecompositionService |
| resolve_command_targets | commandDecompositionService |
| compose_reply | assistantReplyComposer |
| draft_conversational_reply | conversational skill |
| search_for_question | documentPipeline (retrieveWithAdaptiveThreshold, multiQueryRetrieve) |
| search_for_command | documentPipeline (retrieveRelevantDocuments, retrieveTodoCandidatesForCommand) |

## Handler modules (internal use)

Handlers (thoughtHandler, questionHandler, commandHandler, etc.) are no longer in the main flow. Their logic is invoked by orchestrator tools via the services above.

## Legacy skills (not loaded by the main path)

- `classification.md` — superseded by situation + intent-route + metadata-extraction
- `question.md` — superseded by question-strategist + question-answer
- `save-decomposition.md` — superseded by save-shape + save-items
