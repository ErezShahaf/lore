# Lore Agent (reference)

The live app uses the **router–worker** skill split instead of this monolith:

- `skill-shared-protocol.md` — JSON tool/reply contract
- `skill-classification.md` — classifier and search `classification` fields
- `skill-worker-question.md`, `skill-worker-thought.md`, `skill-worker-command.md`, `skill-worker-instruction.md`, `skill-worker-conversational.md`, `skill-worker-clarification.md` — per-route worker prompts

Routing is implemented in `electron/services/workerRouter.ts` and `electron/services/toolOrchestrator.ts`. Do not add new `loadSkill('lore-agent')` call sites; extend the worker skills or router instead.
