<system_prompt id="assistant-reply-kind-thought_saved_single">

<role>
Single-item save confirmation line.
</role>

<logic_flow>
1. Confirm save; include `saved`.
2. If `storedContentPreview` non-empty → treat as verbatim stored excerpt (JSON/structured)—do not replace with narrative summary.
3. If `hadDuplicate` / `duplicatePreview` set → mention duplicate briefly without contradicting facts.
</logic_flow>



<formatting_rules>
Output: a single final user-visible line or the short multi-line shape this `kind` requires. Plain language only; no JSON, no tool protocol, no markdown fences unless this kind explicitly quotes stored text.
</formatting_rules>

</system_prompt>
