# Lore evals (Promptfoo)

## Running scenarios

- Full suite: `npm run eval:promptfoo -- --models <ollama-model>`
- Smoke: `npm run eval:promptfoo:smoke -- --models <ollama-model>`
- **Qwen 3.5 9B regression subset** (46 scenarios that failed at least once for `qwen3.5:9b` classic or native on the 2026-04-05 full run):  
  `npm run eval:promptfoo:qwen35-problem`  
  Or: `node scripts/run-promptfoo.mjs --suite qwen35-problem --models qwen3.5:9b`  
  Scenario list: [scenarios/qwen35ProblemSuite.mjs](scenarios/qwen35ProblemSuite.mjs) — update that file after new baseline runs.

Summaries: `npm run eval:promptfoo:summary` (optionally `--file evals/results/promptfoo-….json`).

After summarize, `evals/results/.promptfoo-latest.json` points at the raw result filename the summary was built from (for the viewer).

## Results viewer (local UI)

1. Run a promptfoo eval so `evals/results/promptfoo-*.json` exists; run `npm run eval:promptfoo:summary` to refresh `.promptfoo-latest.json`.
2. Start the viewer: `npm run eval:promptfoo:viewer` (Vite on port **5180** by default).
3. In the browser, use **Load latest (dev server)** or **Open JSON** to pick a file.

The dev server serves `evals/results/*` under `/evals/results/…` so fetches work same-origin. For a static build of the viewer only, `vite build --config evals/promptfoo-viewer/vite.config.ts` — then use **Open JSON** (no middleware).

Panels: overview, chat transcript, failed checks (judge vs deterministic), events, retrieval, todos, per-step library snapshot (when present in result JSON), pipeline trace, raw row.
