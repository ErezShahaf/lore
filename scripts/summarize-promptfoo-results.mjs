import { readFileSync, readdirSync, statSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'

const scriptDirectory = fileURLToPath(new URL('.', import.meta.url))
const repositoryRoot = resolve(scriptDirectory, '..')
const resultsDirectory = join(repositoryRoot, 'evals', 'results')

function getArgumentValue(flagName) {
  const flagIndex = process.argv.indexOf(flagName)
  if (flagIndex === -1) {
    return null
  }

  return process.argv[flagIndex + 1] || null
}

function getLatestJsonResultPath() {
  const jsonFiles = readdirSync(resultsDirectory)
    .filter((fileName) => fileName.endsWith('.json'))
    .map((fileName) => {
      const fullPath = join(resultsDirectory, fileName)
      return {
        fileName,
        fullPath,
        modifiedAtMs: statSync(fullPath).mtimeMs,
      }
    })
    .sort((left, right) => right.modifiedAtMs - left.modifiedAtMs)

  if (jsonFiles.length === 0) {
    throw new Error(`No JSON result files found in ${resultsDirectory}`)
  }

  return jsonFiles[0].fullPath
}

function parseJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'))
}

function getScenarioId(row) {
  return row.metadata?.scenarioId
    || row.response?.metadata?.scenarioId
    || row.vars?.scenarioId
    || row.prompt?.raw
    || 'unknown-scenario'
}

function getScenarioTitle(row) {
  return row.metadata?.scenarioTitle
    || row.response?.metadata?.scenarioTitle
    || row.testCase?.description
    || getScenarioId(row)
}

function getScenarioTopic(row) {
  return row.metadata?.topic
    || row.response?.metadata?.topic
    || 'unknown-topic'
}

function getProviderLabel(row) {
  return row.provider?.label || row.provider?.id || 'unknown-provider'
}

function getFailureReasons(row) {
  return row.response?.metadata?.failures || []
}

function getFailedChecks(row) {
  return row.response?.metadata?.failedChecks || []
}

function getTranscript(row) {
  return row.response?.metadata?.transcript || []
}

function stringifyValue(value) {
  if (value === undefined) {
    return 'undefined'
  }

  if (value === null) {
    return 'null'
  }

  if (typeof value === 'string') {
    return value
  }

  try {
    const stringifiedValue = JSON.stringify(value, null, 2)
    return typeof stringifiedValue === 'string' ? stringifiedValue : String(value)
  } catch {
    return String(value)
  }
}

function truncateText(value, maxLength = 240) {
  if (value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, maxLength - 3)}...`
}

function getInteractionTurns(step) {
  if (Array.isArray(step?.interactionTurns) && step.interactionTurns.length > 0) {
    return step.interactionTurns
  }

  if (typeof step?.userInput === 'string' || typeof step?.response === 'string') {
    return [{
      userInput: step.userInput || '',
      response: step.response || '',
      events: Array.isArray(step.events) ? step.events : [],
    }]
  }

  return []
}

function getFailureStageLabel(row) {
  const failureReasons = getFailureReasons(row)
  const failedChecks = getFailedChecks(row)
  const transcript = getTranscript(row)
  const firstFailedCheck = failedChecks[0]

  for (const failureReason of failureReasons) {
    const stepMatch = /^Step\s+(\d+):/i.exec(failureReason)
    if (!stepMatch) {
      continue
    }

    const stepIndex = Number.parseInt(stepMatch[1], 10) - 1
    const step = transcript[stepIndex]
    if (!step) {
      return `Step ${stepIndex + 1}`
    }

    const interactionTurns = getInteractionTurns(step)
    const lastTurn = interactionTurns[interactionTurns.length - 1]
    const statuses = Array.isArray(lastTurn?.events)
      ? lastTurn.events
        .filter((event) => event?.type === 'status' && typeof event.message === 'string')
        .map((event) => event.message)
      : []

    const stageLabel = statuses.length > 0 ? statuses[statuses.length - 1] : 'No status emitted'
    return `Step ${stepIndex + 1} @ ${stageLabel}`
  }

  if (typeof firstFailedCheck?.stepIndex === 'number') {
    return `Step ${firstFailedCheck.stepIndex + 1}`
  }

  return 'Unknown stage'
}

function incrementCount(map, key) {
  map.set(key, (map.get(key) || 0) + 1)
}

function buildFailureExample(row) {
  const failedChecks = getFailedChecks(row)
  const transcript = getTranscript(row)
  const firstFailedCheck = failedChecks[0] || null
  const stepIndex = typeof firstFailedCheck?.stepIndex === 'number'
    ? firstFailedCheck.stepIndex
    : 0
  const failedStep = transcript[stepIndex] || null
  const interactionTurns = getInteractionTurns(failedStep)

  return {
    failureReasons: getFailureReasons(row),
    failedChecks: failedChecks.slice(0, 3).map((failedCheck) => ({
      stepIndex: failedCheck.stepIndex,
      checkType: failedCheck.checkType,
      reason: failedCheck.reason,
      expected: stringifyValue(failedCheck.expected),
      actual: truncateText(stringifyValue(failedCheck.actual), 400),
    })),
    attemptedConversation: interactionTurns.map((turn) => ({
      userInput: turn.userInput || '',
      response: turn.response || '',
    })),
  }
}

function summarizeResults(rows) {
  const summaryByScenario = new Map()

  for (const row of rows) {
    const providerLabel = getProviderLabel(row)
    const scenarioId = getScenarioId(row)
    const scenarioTitle = getScenarioTitle(row)
    const topic = getScenarioTopic(row)
    const groupingKey = `${providerLabel}::${scenarioId}`

    if (!summaryByScenario.has(groupingKey)) {
      summaryByScenario.set(groupingKey, {
        providerLabel,
        scenarioId,
        scenarioTitle,
        topic,
        passCount: 0,
        totalCount: 0,
        failureReasons: new Map(),
        failureStages: new Map(),
        failedCheckTypes: new Map(),
        failureExamples: [],
      })
    }

    const scenarioSummary = summaryByScenario.get(groupingKey)
    scenarioSummary.totalCount += 1

    if (row.success) {
      scenarioSummary.passCount += 1
      continue
    }

    const failureReasons = getFailureReasons(row)
    if (failureReasons.length === 0) {
      incrementCount(scenarioSummary.failureReasons, 'Unknown failure')
    } else {
      for (const failureReason of failureReasons) {
        incrementCount(scenarioSummary.failureReasons, failureReason)
      }
    }

    const failedChecks = getFailedChecks(row)
    for (const failedCheck of failedChecks) {
      incrementCount(scenarioSummary.failedCheckTypes, failedCheck.checkType || 'unknown-check')
    }

    incrementCount(scenarioSummary.failureStages, getFailureStageLabel(row))

    if (scenarioSummary.failureExamples.length < 2) {
      scenarioSummary.failureExamples.push(buildFailureExample(row))
    }
  }

  return [...summaryByScenario.values()].sort((left, right) => {
    if (left.providerLabel !== right.providerLabel) {
      return left.providerLabel.localeCompare(right.providerLabel)
    }

    const leftPassRate = left.totalCount === 0 ? 0 : left.passCount / left.totalCount
    const rightPassRate = right.totalCount === 0 ? 0 : right.passCount / right.totalCount
    if (leftPassRate !== rightPassRate) {
      return leftPassRate - rightPassRate
    }

    return left.scenarioTitle.localeCompare(right.scenarioTitle)
  })
}

function formatTopCounts(countMap, limit) {
  return [...countMap.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
}

function renderFailureExampleMarkdown(failureExample) {
  const lines = []

  if (failureExample.failedChecks.length > 0) {
    lines.push('    Sample failed checks:')
    for (const failedCheck of failureExample.failedChecks) {
      lines.push(`      - ${failedCheck.checkType}: ${failedCheck.reason}`)
      lines.push(`        expected: ${truncateText(failedCheck.expected, 180)}`)
      lines.push(`        actual: ${truncateText(failedCheck.actual, 180)}`)
    }
  }

  if (failureExample.attemptedConversation.length > 0) {
    lines.push('    Attempted conversation:')
    for (const attemptedTurn of failureExample.attemptedConversation) {
      lines.push(`      - user: ${truncateText(attemptedTurn.userInput, 180)}`)
      lines.push(`        assistant: ${truncateText(attemptedTurn.response, 180)}`)
    }
  }

  return lines.join('\n')
}

function buildOverallTotals(summaryRows) {
  const totalCount = summaryRows.reduce((sum, summaryRow) => sum + summaryRow.totalCount, 0)
  const passCount = summaryRows.reduce((sum, summaryRow) => sum + summaryRow.passCount, 0)
  const failedCount = totalCount - passCount

  return {
    totalCount,
    passCount,
    failedCount,
    passPercentage: totalCount === 0 ? 0 : (passCount / totalCount) * 100,
  }
}

function getRowLatencyMilliseconds(row) {
  if (typeof row.latencyMs !== 'number' || Number.isNaN(row.latencyMs)) {
    return 0
  }

  return row.latencyMs
}

function summarizeByProvider(rows) {
  const byLabel = new Map()

  for (const row of rows) {
    const providerLabel = getProviderLabel(row)
    if (!byLabel.has(providerLabel)) {
      byLabel.set(providerLabel, {
        providerLabel,
        passCount: 0,
        failCount: 0,
        totalCount: 0,
        totalLatencyMs: 0,
      })
    }

    const entry = byLabel.get(providerLabel)
    entry.totalCount += 1
    if (row.success) {
      entry.passCount += 1
    } else {
      entry.failCount += 1
    }

    entry.totalLatencyMs += getRowLatencyMilliseconds(row)
  }

  return [...byLabel.values()].sort((left, right) =>
    left.providerLabel.localeCompare(right.providerLabel),
  )
}

function formatDurationMilliseconds(durationMilliseconds) {
  if (durationMilliseconds < 1000) {
    return `${Math.round(durationMilliseconds)} ms`
  }

  const totalSeconds = durationMilliseconds / 1000
  if (totalSeconds < 60) {
    return `${totalSeconds.toFixed(1)} s`
  }

  const wholeMinutes = Math.floor(totalSeconds / 60)
  const remainderSeconds = totalSeconds % 60
  return `${wholeMinutes}m ${remainderSeconds.toFixed(0)}s`
}

function printSummary(resultPath, summaryRows, providerSummaries) {
  const overallTotals = buildOverallTotals(summaryRows)

  console.log(`Promptfoo summary for ${resultPath}`)
  console.log('')
  console.log(
    `Overall: ${overallTotals.passCount} passed, ${overallTotals.failedCount} failed, ${overallTotals.totalCount} total (${overallTotals.passPercentage.toFixed(1)}% pass rate)`,
  )
  console.log('')
  console.log('Per model (pass/fail counts are over all scenario repeats; time is sum of per-test latencyMs):')
  for (const providerSummary of providerSummaries) {
    const passRate = providerSummary.totalCount === 0
      ? 0
      : (providerSummary.passCount / providerSummary.totalCount) * 100
    console.log(
      `  [${providerSummary.providerLabel}] ${providerSummary.passCount} passed, ` +
        `${providerSummary.failCount} failed, ${providerSummary.totalCount} total ` +
        `(${passRate.toFixed(1)}% pass) — ${formatDurationMilliseconds(providerSummary.totalLatencyMs)} ` +
        `(${Math.round(providerSummary.totalLatencyMs)} ms total latency)`,
    )
  }
  console.log('')

  for (const summaryRow of summaryRows) {
    const passPercentage = summaryRow.totalCount === 0
      ? 0
      : (summaryRow.passCount / summaryRow.totalCount) * 100

    console.log(
      `[${summaryRow.providerLabel}] ${summaryRow.scenarioId}: ${summaryRow.passCount}/${summaryRow.totalCount} passed (${passPercentage.toFixed(1)}%)`,
    )
    console.log(`  ${summaryRow.scenarioTitle}`)

    const topFailureStages = formatTopCounts(summaryRow.failureStages, 3)
    if (topFailureStages.length > 0) {
      console.log('  Failure stages:')
      for (const [failureStage, count] of topFailureStages) {
        console.log(`    ${count}x ${failureStage}`)
      }
    }

    const topFailureReasons = formatTopCounts(summaryRow.failureReasons, 3)
    if (topFailureReasons.length > 0) {
      console.log('  Failure reasons:')
      for (const [failureReason, count] of topFailureReasons) {
        console.log(`    ${count}x ${failureReason}`)
      }
    }

    const topFailedCheckTypes = formatTopCounts(summaryRow.failedCheckTypes, 3)
    if (topFailedCheckTypes.length > 0) {
      console.log('  Failed check types:')
      for (const [checkType, count] of topFailedCheckTypes) {
        console.log(`    ${count}x ${checkType}`)
      }
    }

    if (summaryRow.failureExamples.length > 0) {
      console.log('  Sample failures:')
      for (const failureExample of summaryRow.failureExamples) {
        for (const failedCheck of failureExample.failedChecks) {
          console.log(`    ${failedCheck.checkType}: ${failedCheck.reason}`)
          console.log(`      expected: ${truncateText(failedCheck.expected, 140)}`)
          console.log(`      actual: ${truncateText(failedCheck.actual, 140)}`)
        }

        for (const attemptedTurn of failureExample.attemptedConversation) {
          console.log(`    user: ${truncateText(attemptedTurn.userInput, 140)}`)
          console.log(`    assistant: ${truncateText(attemptedTurn.response, 140)}`)
        }
      }
    }

    console.log('')
  }

  console.log(
    `Final totals: ${overallTotals.passCount} passed, ${overallTotals.failedCount} failed, ${overallTotals.totalCount} total`,
  )
}

function createSummaryArtifactPaths(resultPath) {
  const normalizedResultPath = resultPath.endsWith('.json')
    ? resultPath.slice(0, -5)
    : resultPath

  return {
    jsonPath: `${normalizedResultPath}-summary.json`,
    markdownPath: `${normalizedResultPath}-summary.md`,
  }
}

function writeSummaryArtifacts(resultPath, summaryRows, providerSummaries) {
  const artifactPaths = createSummaryArtifactPaths(resultPath)
  const overallTotals = buildOverallTotals(summaryRows)
  const summaryPayload = {
    resultPath,
    generatedAt: new Date().toISOString(),
    totals: overallTotals,
    byProvider: providerSummaries.map((providerSummary) => ({
      providerLabel: providerSummary.providerLabel,
      passCount: providerSummary.passCount,
      failCount: providerSummary.failCount,
      totalCount: providerSummary.totalCount,
      passPercentage: providerSummary.totalCount === 0
        ? 0
        : (providerSummary.passCount / providerSummary.totalCount) * 100,
      totalLatencyMs: Math.round(providerSummary.totalLatencyMs),
      totalLatencyHuman: formatDurationMilliseconds(providerSummary.totalLatencyMs),
    })),
    scenarios: summaryRows.map((summaryRow) => ({
      providerLabel: summaryRow.providerLabel,
      scenarioId: summaryRow.scenarioId,
      scenarioTitle: summaryRow.scenarioTitle,
      topic: summaryRow.topic,
      passCount: summaryRow.passCount,
      totalCount: summaryRow.totalCount,
      passPercentage: summaryRow.totalCount === 0
        ? 0
        : (summaryRow.passCount / summaryRow.totalCount) * 100,
      topFailureStages: formatTopCounts(summaryRow.failureStages, 5),
      topFailureReasons: formatTopCounts(summaryRow.failureReasons, 5),
      topFailedCheckTypes: formatTopCounts(summaryRow.failedCheckTypes, 5),
      failureExamples: summaryRow.failureExamples,
    })),
  }

  const markdownLines = [
    `# Promptfoo Summary`,
    '',
    `Result file: \`${resultPath}\``,
    '',
    `Overall: ${overallTotals.passCount} passed, ${overallTotals.failedCount} failed, ${overallTotals.totalCount} total (${overallTotals.passPercentage.toFixed(1)}% pass rate)`,
    '',
    `## Per model`,
    '',
    '_Pass/fail counts are over all scenario repeats; time is the sum of each row\'s \`latencyMs\` (serial-ish wall time when concurrency is 1)._',
    '',
  ]

  for (const providerSummary of providerSummaries) {
    const passRate = providerSummary.totalCount === 0
      ? 0
      : (providerSummary.passCount / providerSummary.totalCount) * 100
    markdownLines.push(
      `### ${providerSummary.providerLabel}`,
      '',
      `- Passed: ${providerSummary.passCount}, failed: ${providerSummary.failCount}, total: ${providerSummary.totalCount} (${passRate.toFixed(1)}% pass)`,
      `- Summed latency: **${formatDurationMilliseconds(providerSummary.totalLatencyMs)}** (${Math.round(providerSummary.totalLatencyMs)} ms)`,
      '',
    )
  }

  for (const summaryRow of summaryRows) {
    const passPercentage = summaryRow.totalCount === 0
      ? 0
      : (summaryRow.passCount / summaryRow.totalCount) * 100

    markdownLines.push(`## [${summaryRow.providerLabel}] ${summaryRow.scenarioId}`)
    markdownLines.push('')
    markdownLines.push(`${summaryRow.scenarioTitle}`)
    markdownLines.push('')
    markdownLines.push(`Topic: \`${summaryRow.topic}\``)
    markdownLines.push('')
    markdownLines.push(`Pass rate: ${summaryRow.passCount}/${summaryRow.totalCount} (${passPercentage.toFixed(1)}%)`)
    markdownLines.push('')

    const topFailureStages = formatTopCounts(summaryRow.failureStages, 3)
    if (topFailureStages.length > 0) {
      markdownLines.push('Failure stages:')
      for (const [failureStage, count] of topFailureStages) {
        markdownLines.push(`- ${count}x ${failureStage}`)
      }
      markdownLines.push('')
    }

    const topFailureReasons = formatTopCounts(summaryRow.failureReasons, 3)
    if (topFailureReasons.length > 0) {
      markdownLines.push('Failure reasons:')
      for (const [failureReason, count] of topFailureReasons) {
        markdownLines.push(`- ${count}x ${failureReason}`)
      }
      markdownLines.push('')
    }

    const topFailedCheckTypes = formatTopCounts(summaryRow.failedCheckTypes, 3)
    if (topFailedCheckTypes.length > 0) {
      markdownLines.push('Failed check types:')
      for (const [checkType, count] of topFailedCheckTypes) {
        markdownLines.push(`- ${count}x ${checkType}`)
      }
      markdownLines.push('')
    }

    if (summaryRow.failureExamples.length > 0) {
      markdownLines.push('Sample failures:')
      for (const failureExample of summaryRow.failureExamples) {
        markdownLines.push(renderFailureExampleMarkdown(failureExample))
      }
      markdownLines.push('')
    }
  }

  markdownLines.push(`Final totals: ${overallTotals.passCount} passed, ${overallTotals.failedCount} failed, ${overallTotals.totalCount} total`)

  writeFileSync(artifactPaths.jsonPath, JSON.stringify(summaryPayload, null, 2), 'utf-8')
  writeFileSync(artifactPaths.markdownPath, `${markdownLines.join('\n').trim()}\n`, 'utf-8')
  return artifactPaths
}

function main() {
  const explicitPath = getArgumentValue('--file')
  const resultPath = explicitPath ? resolve(repositoryRoot, explicitPath) : getLatestJsonResultPath()
  const parsed = parseJson(resultPath)
  const rows = parsed?.results?.results

  if (!Array.isArray(rows)) {
    throw new Error(`Unexpected promptfoo JSON structure in ${resultPath}`)
  }

  const summaryRows = summarizeResults(rows)
  const providerSummaries = summarizeByProvider(rows)
  printSummary(resultPath, summaryRows, providerSummaries)
  const artifactPaths = writeSummaryArtifacts(resultPath, summaryRows, providerSummaries)
  console.log(`Wrote summary JSON to ${artifactPaths.jsonPath}`)
  console.log(`Wrote summary Markdown to ${artifactPaths.markdownPath}`)
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
