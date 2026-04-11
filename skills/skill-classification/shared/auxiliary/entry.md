<system_prompt id="auxiliary-root">

<role>
Supporting prompts outside classifier `intent` (no `auxiliary` route). Loaded by situation, intent-route, metadata extraction, orchestrator clarification, UI status, etc.
</role>

<logic_flow>
1. LOCATION: Under `skill-classification/shared/auxiliary/`—not `decisions/` intent routing.
</logic_flow>

<formatting_rules>
| Folder | `loadSkill` id |
|--------|----------------|
| `decisions/situation/` | `situation` |
| `decisions/intent-route/` | `intent-route` |
| `decisions/metadata-extraction/` | `metadata-extraction` |
| `decisions/orchestrator-low-confidence/` | `orchestrator-low-confidence` |
| `decisions/ui-status-phrase/` | `ui-status-phrase` |
</formatting_rules>

</system_prompt>
