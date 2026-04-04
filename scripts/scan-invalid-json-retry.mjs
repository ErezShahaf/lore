import { readFileSync } from 'fs'
import { resolve } from 'path'

const path = resolve('evals/results/promptfoo-full-2026-04-04T13-30-23-318Z.json')
const data = JSON.parse(readFileSync(path, 'utf8'))
const results = Array.isArray(data.results?.results) ? data.results.results : []

const toolNames = new Set([
  'save_documents',
  'search_for_question',
  'search_for_command',
  'get_document',
  'modify_documents',
  'summarize_context',
])

function isNativeRow(row) {
  const label = row.provider?.label ?? row.vars?.providerLabel ?? ''
  return String(label).includes('native')
}

let nativeTotal = 0
let nativeFailed = 0
const shorthandSamples = []
const otherInvalidSamples = []
let roundsWithInvalid = 0
let roundsShorthand = 0
let roundsOtherInvalid = 0

function forEachNativeStage(row, callback) {
  const transcript = row.response?.metadata?.transcript
  if (!Array.isArray(transcript)) {
    return
  }
  for (const step of transcript) {
    const turns = step?.interactionTurns
    if (!Array.isArray(turns)) {
      continue
    }
    for (const turn of turns) {
      const trace = turn?.pipelineTrace
      if (!Array.isArray(trace)) {
        continue
      }
      for (const stage of trace) {
        if (stage?.stageId === 'turn_engine_native_round') {
          callback(stage)
        }
      }
    }
  }
}

for (const row of results) {
  if (!isNativeRow(row)) {
    continue
  }
  nativeTotal += 1
  const passed = row.success === true
  if (!passed) {
    nativeFailed += 1
  }

  forEachNativeStage(row, (stage) => {
    const stop = stage?.output?.stopReason
    const preview = typeof stage?.output?.assistantPreview === 'string' ? stage.output.assistantPreview : ''
    if (stop !== 'invalid_json_retry') {
      return
    }
    roundsWithInvalid += 1
    let parsed = null
    try {
      parsed = JSON.parse(preview)
    } catch {
      roundsOtherInvalid += 1
      if (otherInvalidSamples.length < 8) {
        otherInvalidSamples.push(preview.slice(0, 200))
      }
      return
    }
    const action = typeof parsed.action === 'string' ? parsed.action : ''
    if (toolNames.has(action)) {
      roundsShorthand += 1
      if (shorthandSamples.length < 6) {
        shorthandSamples.push(preview.slice(0, 350))
      }
    } else {
      roundsOtherInvalid += 1
      if (otherInvalidSamples.length < 8) {
        otherInvalidSamples.push(preview.slice(0, 200))
      }
    }
  })
}

function collectNativeFailureBuckets(results) {
  const buckets = {
    sawInvalidJsonRetry: [],
    lastStopModelReplyNoTool: [],
    lastStopReplyOrStream: [],
    hadToolRoundButFailed: [],
    other: [],
  }

  for (const row of results) {
    if (!isNativeRow(row)) {
      continue
    }
    if (row.success === true) {
      continue
    }
    const scenarioId = row.vars?.scenarioId ?? row.testCase?.vars?.scenarioId ?? 'unknown'
    let sawInvalid = false
    let lastNative = null
    forEachNativeStage(row, (stage) => {
      if (stage?.output?.stopReason === 'invalid_json_retry') {
        sawInvalid = true
      }
      lastNative = stage?.output ?? null
    })
    const stop = lastNative?.stopReason ?? 'none'
    const hadTool = lastNative?.hadToolCalls === true

    const entry = { scenarioId, lastStopReason: stop, hadToolOnLastRound: hadTool }

    if (sawInvalid) {
      buckets.sawInvalidJsonRetry.push(entry)
    } else if (stop === 'model_reply' && !hadTool) {
      buckets.lastStopModelReplyNoTool.push(entry)
    } else if (stop === 'reply' || stop === 'stream_result') {
      buckets.lastStopReplyOrStream.push(entry)
    } else if (hadTool || stop === 'tool_round') {
      buckets.hadToolRoundButFailed.push(entry)
    } else {
      buckets.other.push(entry)
    }
  }

  const count = (list) => list.length
  return {
    nativeFailedScenarioCount: count([
      ...buckets.sawInvalidJsonRetry,
      ...buckets.lastStopModelReplyNoTool,
      ...buckets.lastStopReplyOrStream,
      ...buckets.hadToolRoundButFailed,
      ...buckets.other,
    ]),
    bucketCounts: {
      sawInvalidJsonRetry: count(buckets.sawInvalidJsonRetry),
      lastStopModelReplyNoTool: count(buckets.lastStopModelReplyNoTool),
      lastStopReplyOrStream: count(buckets.lastStopReplyOrStream),
      hadToolRoundButFailed: count(buckets.hadToolRoundButFailed),
      other: count(buckets.other),
    },
    note:
      'sawInvalidJsonRetry: host rejected JSON (shorthand fix targets this class). lastStopModelReplyNoTool: model ended with JSON reply without a tool call. lastStopReplyOrStream: normal end path but assertions/judges failed. hadToolRoundButFailed: last native round executed tools; failure is later state or rubric.',
    samples: {
      invalidJsonRetry: buckets.sawInvalidJsonRetry.slice(0, 5),
      modelReplyNoTool: buckets.lastStopModelReplyNoTool.slice(0, 5),
    },
  }
}

const quantification = {
  path,
  nativeTotal,
  nativeFailed,
  invalidJsonRetryRounds: roundsWithInvalid,
  shorthandToolAsActionRounds: roundsShorthand,
  otherInvalidOrNonShorthandRounds: roundsOtherInvalid,
  shorthandSamples,
  otherSamples: otherInvalidSamples,
}

const retriage = collectNativeFailureBuckets(results)

console.log(JSON.stringify({ quantification, retriage }, null, 2))
