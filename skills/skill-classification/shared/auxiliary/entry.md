# Auxiliary prompts

Supporting models **not** chosen as classifier **`intent`** (there is no `auxiliary` route from the unified classifier). These prompts are loaded by **`situationService`**, **`intentRouteService`**, **`metadataExtractionService`**, **`orchestratorClarificationReply`**, and similar entry points. They live under **`skill-classification/shared/auxiliary/`**— **`shared/`** holds everything that is not classifier routing at this level.

## Agents (`decisions/`)

| Folder | `loadSkill` id |
|--------|----------------|
| `decisions/situation/` | `situation` |
| `decisions/intent-route/` | `intent-route` |
| `decisions/metadata-extraction/` | `metadata-extraction` |
| `decisions/orchestrator-low-confidence/` | `orchestrator-low-confidence` |
| `decisions/ui-status-phrase/` | `ui-status-phrase` |
