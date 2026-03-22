import { mkdirSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { spawn } from 'child_process'
import { scenarioTopics, scenarios } from '../evals/scenarios/catalog.mjs'

const scriptDirectory = fileURLToPath(new URL('.', import.meta.url))
const repositoryRoot = resolve(scriptDirectory, '..')
const generatedDirectory = join(repositoryRoot, 'evals', '.generated')
const resultsDirectory = join(repositoryRoot, 'evals', 'results')

function getArgumentValues(flagName) {
  const values = []

  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === flagName && process.argv[index + 1]) {
      values.push(process.argv[index + 1])
    }
  }

  return values
}

function getSingleArgumentValue(flagName, fallbackValue) {
  const values = getArgumentValues(flagName)
  return values.length > 0 ? values[values.length - 1] : fallbackValue
}

function hasFlag(flagName) {
  return process.argv.includes(flagName)
}

function getNpmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

function getPromptfooCommand() {
  return join(
    repositoryRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'promptfoo.cmd' : 'promptfoo',
  )
}

function runCommand(command, args) {
  return new Promise((resolveRun, reject) => {
    const childProcess = spawn(command, args, {
      cwd: repositoryRoot,
      stdio: 'inherit',
      env: process.env,
      shell: process.platform === 'win32',
    })

    childProcess.on('error', reject)
    childProcess.on('exit', (exitCode) => {
      if (exitCode === 0 || exitCode === 100) {
        resolveRun(exitCode)
        return
      }

      reject(new Error(`${command} ${args.join(' ')} exited with code ${exitCode ?? 'unknown'}`))
    })
  })
}

function parseModels() {
  const rawModelValues = [
    ...getArgumentValues('--models'),
    ...getArgumentValues('--model'),
  ]

  const models = rawModelValues
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter((value) => value.length > 0)

  return [...new Set(models)]
}

function parseScenarioIds() {
  const rawScenarioValues = getArgumentValues('--scenario')

  const scenarioIds = rawScenarioValues
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter((value) => value.length > 0)

  return [...new Set(scenarioIds)]
}

function parseTopics() {
  const rawTopicValues = getArgumentValues('--topic')

  const topics = rawTopicValues
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter((value) => value.length > 0)

  return [...new Set(topics)]
}

function getScenariosForSuite(suiteName) {
  return scenarios.filter((scenario) => scenario.suites.includes(suiteName))
}

function getTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

async function fetchOllamaModelNames(ollamaHost) {
  const response = await fetch(`${ollamaHost}/api/tags`, {
    signal: AbortSignal.timeout(10_000),
  })

  if (!response.ok) {
    throw new Error(`Failed to list Ollama models from ${ollamaHost}: ${response.status} ${response.statusText}`)
  }

  const data = await response.json()
  const models = Array.isArray(data.models) ? data.models : []
  return models
    .map((model) => (typeof model?.name === 'string' ? model.name : ''))
    .filter((modelName) => modelName.length > 0)
}

function chooseDefaultEmbeddingModel(modelNames) {
  const embeddingModelNames = modelNames.filter((modelName) => /embed/i.test(modelName))
  if (embeddingModelNames.length === 0) {
    return null
  }

  const preferredModelNames = [
    'nomic-embed-text',
    'qwen3-embedding:0.6b',
    'qwen3-embedding',
  ]

  for (const preferredModelName of preferredModelNames) {
    const matchingModelName = embeddingModelNames.find((modelName) => modelName === preferredModelName)
    if (matchingModelName) {
      return matchingModelName
    }
  }

  return embeddingModelNames[0]
}

async function resolveEmbeddingModel(ollamaHost, requestedEmbeddingModel) {
  const modelNames = await fetchOllamaModelNames(ollamaHost)

  if (requestedEmbeddingModel) {
    if (!modelNames.includes(requestedEmbeddingModel)) {
      throw new Error(
        `Embedding model "${requestedEmbeddingModel}" is not installed in Ollama. Installed models: ${modelNames.join(', ')}`,
      )
    }

    return requestedEmbeddingModel
  }

  const selectedEmbeddingModel = chooseDefaultEmbeddingModel(modelNames)
  if (!selectedEmbeddingModel) {
    throw new Error(
      `Could not find an installed embedding model in Ollama. Installed models: ${modelNames.join(', ')}`,
    )
  }

  return selectedEmbeddingModel
}

function buildPromptfooConfig({
  selectedModels,
  selectedScenarios,
  repeatCount,
  embeddingModel,
  ollamaHost,
  judgeModel,
}) {
  const providerPath = join(repositoryRoot, 'evals', 'provider', 'loreScenarioProvider.mjs')

  return {
    description: 'Lore promptfoo conversation evals',
    prompts: ['{{scenarioId}}'],
    providers: selectedModels.map((modelName) => ({
      id: providerPath,
      label: modelName,
      config: {
        repositoryRoot,
        model: modelName,
        embeddingModel,
        ollamaHost,
        judgeModel,
      },
    })),
    defaultTest: {
      assert: [
        {
          type: 'javascript',
          value: `
            const metadata = context.providerResponse?.metadata ?? {};
            return {
              pass: metadata.passed === true,
              score: metadata.passed === true ? 1 : 0,
              reason: metadata.summary || metadata.failures?.join('\\n') || 'Scenario failed',
            };
          `,
        },
      ],
    },
    tests: selectedScenarios.map((scenario) => ({
      vars: {
        scenarioId: scenario.id,
      },
      metadata: {
        scenarioId: scenario.id,
        scenarioTitle: scenario.title,
        topic: scenario.topic,
        suites: scenario.suites,
      },
      description: scenario.title,
    })),
    evaluateOptions: {
      repeat: repeatCount,
      cache: false,
      maxConcurrency: 1,
    },
  }
}

async function main() {
  const selectedModels = parseModels()
  if (selectedModels.length === 0) {
    throw new Error('Provide at least one model with --models qwen3.5:4b,qwen3.5:9b or repeated --model flags.')
  }

  const suiteName = getSingleArgumentValue('--suite', 'full')
  if (suiteName !== 'smoke' && suiteName !== 'full') {
    throw new Error(`Unsupported suite "${suiteName}". Use smoke or full.`)
  }

  const repeatCount = Number.parseInt(getSingleArgumentValue('--repeat', '10'), 10)
  if (!Number.isInteger(repeatCount) || repeatCount <= 0) {
    throw new Error('Repeat count must be a positive integer.')
  }

  const requestedEmbeddingModel = getSingleArgumentValue('--embedding-model', '')
  const ollamaHost = getSingleArgumentValue('--ollama-host', 'http://127.0.0.1:11434')
  const judgeModel = getSingleArgumentValue('--judge-model', '')
  const skipBuild = hasFlag('--skip-build')
  const shouldWriteHtmlReport = hasFlag('--html-report')
  const requestedScenarioIds = parseScenarioIds()
  const requestedTopics = parseTopics()
  const embeddingModel = await resolveEmbeddingModel(ollamaHost, requestedEmbeddingModel)
  const suiteScenarios = getScenariosForSuite(suiteName)
  const unknownTopics = requestedTopics.filter((requestedTopic) => !scenarioTopics.includes(requestedTopic))

  if (unknownTopics.length > 0) {
    throw new Error(
      `Unknown topics: ${unknownTopics.join(', ')}. Available topics: ${scenarioTopics.join(', ')}`,
    )
  }

  const topicFilteredScenarios = requestedTopics.length === 0
    ? suiteScenarios
    : suiteScenarios.filter((scenario) => requestedTopics.includes(scenario.topic))

  const selectedScenarios = requestedScenarioIds.length === 0
    ? topicFilteredScenarios
    : topicFilteredScenarios.filter((scenario) => requestedScenarioIds.includes(scenario.id))

  const missingScenarioIds = requestedScenarioIds.filter(
    (requestedScenarioId) => !topicFilteredScenarios.some((scenario) => scenario.id === requestedScenarioId),
  )
  if (missingScenarioIds.length > 0) {
    throw new Error(
      `Unknown scenarios for suite "${suiteName}" and selected topics: ${missingScenarioIds.join(', ')}`,
    )
  }

  if (selectedScenarios.length === 0) {
    throw new Error(`No scenarios match suite "${suiteName}" with the selected filters.`)
  }

  mkdirSync(generatedDirectory, { recursive: true })
  mkdirSync(resultsDirectory, { recursive: true })

  const timestamp = getTimestamp()
  const configPath = join(generatedDirectory, `promptfoo-${suiteName}-${timestamp}.json`)
  const jsonOutputPath = join(resultsDirectory, `promptfoo-${suiteName}-${timestamp}.json`)
  const htmlOutputPath = join(resultsDirectory, `promptfoo-${suiteName}-${timestamp}.html`)
  const config = buildPromptfooConfig({
    selectedModels,
    selectedScenarios,
    repeatCount,
    embeddingModel,
    ollamaHost,
    judgeModel,
  })

  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')

  console.log(`Running ${selectedScenarios.length} scenarios x ${repeatCount} repeats for models: ${selectedModels.join(', ')}`)
  console.log(`Using embedding model: ${embeddingModel}`)
  if (requestedTopics.length > 0) {
    console.log(`Selected topics: ${requestedTopics.join(', ')}`)
  }

  if (!skipBuild) {
    await runCommand(getNpmCommand(), ['run', 'build:app'])
  }

  const promptfooArguments = [
    'eval',
    '-c',
    configPath,
    '-j',
    '1',
    '--no-cache',
    '--output',
    jsonOutputPath,
  ]

  if (shouldWriteHtmlReport) {
    promptfooArguments.push('--output', htmlOutputPath)
  }

  const promptfooExitCode = await runCommand(getPromptfooCommand(), promptfooArguments)

  console.log(`Saved Promptfoo JSON results to ${jsonOutputPath}`)
  if (shouldWriteHtmlReport) {
    console.log(`Saved Promptfoo HTML report to ${htmlOutputPath}`)
  }

  await runCommand('node', [
    join(repositoryRoot, 'scripts', 'summarize-promptfoo-results.mjs'),
    '--file',
    jsonOutputPath,
  ])

  if (promptfooExitCode === 100) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
