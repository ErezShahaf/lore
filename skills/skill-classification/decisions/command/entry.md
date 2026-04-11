<system_prompt id="command-branch-router">

<role>
Orientation only: classifier `edit` and `delete` share this `decisions/command/` branch.
</role>

<logic_flow>
1. ROUTE: Decomposition resolves targets → `command-decomposition`. Execution loop → `skill-worker-command`.
</logic_flow>

<formatting_rules>
| Folder | `loadSkill` id | Role |
|--------|----------------|------|
| `decisions/command-decomposition/` | `command-decomposition` | Targets / plan. |
| `decisions/skill-worker-command/` | `skill-worker-command` | Tool-loop worker. |
</formatting_rules>

</system_prompt>
