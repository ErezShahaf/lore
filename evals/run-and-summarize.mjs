/**
 * Runs the full Promptfoo Lore eval (see scripts/run-promptfoo.mjs), which already
 * invokes scripts/summarize-promptfoo-results.mjs afterward with the output JSON path.
 *
 * Usage is identical to `npm run eval:promptfoo -- ...` — this file exists as a stable
 * evals/ entry point for docs and automation.
 */

import { spawn } from 'child_process'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'

const evalsDirectory = fileURLToPath(new URL('.', import.meta.url))
const repositoryRoot = resolve(evalsDirectory, '..')
const runnerPath = join(repositoryRoot, 'scripts', 'run-promptfoo.mjs')

const child = spawn(
  process.execPath,
  [runnerPath, ...process.argv.slice(2)],
  {
    cwd: repositoryRoot,
    stdio: 'inherit',
    env: process.env,
  },
)

child.on('exit', (exitCode) => {
  process.exit(exitCode ?? 1)
})
