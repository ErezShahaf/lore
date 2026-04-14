import electronPath from 'electron'
import { randomUUID } from 'crypto'
import { mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { spawn } from 'child_process'
import { createServer } from 'net'
import { getScenarioById } from '../scenarios/catalog.mjs'

const providerDirectory = dirname(fileURLToPath(import.meta.url))
const defaultRepositoryRoot = resolve(providerDirectory, '../..')
const activeServersByKey = new Map()
const judgeSystemPrompt = [
  'You are an evaluation judge for Lore conversation tests.',
  'Each grading turn sends you a user message with a rubric and an "actual state" JSON payload; grade the Lore assistant using fields such as "response" or transcript text inside that payload.',
  'IMPORTANT: Only reference facts, entities, and actions that appear in the rubric and actual state provided. If your reason mentions people, documents, or operations not present in the payload, stop and re-read the payload — you are confusing this evaluation with something else.',
  'The assistant under test is conversational: natural language, markdown, numbered lists, bullets, and emojis are expected.',
  'Never require Lore to output JSON, code fences, or a rigid format unless the rubric explicitly demands it.',
  'If your reason would blame the assistant for JSON, verdict keys, or code fences, you confused roles: judge only whether their natural-language reply satisfies the rubric.',
  'For clarification rubrics, pass when they invite the user to specify, choose among options, or narrow scope—including which item, how many, or how broadly to apply a change—with reasonable wording or friendly tone.',
  'Do not fail for a different but valid clarification angle (for example remove-some vs remove-all when several todos could match, or echoing words like "finished" while asking about delete or archive).',
  'A short acknowledgment before a clarifying question is fine unless the assistant also claims the database or list was already updated.',
  'Use pass true only when behavior clearly satisfies the rubric; be strict about claiming completed data changes without user confirmation when the rubric requires waiting on the user first.',
  'Your verdict uses exactly two fields: pass (boolean) and reason (string). The API schema enforces this shape; do not use other top-level keys (no answer, source, explanation, or result).',
].join(' ')

const clarificationRequiredRubric =
  'The assistant must clearly wait on the user before acting: it should ask a question (or present explicit choices) so the user can narrow or confirm what to do. Accept any good-faith disambiguation—including which item, how many items, or how broadly to apply a change—not only one specific wording.'

const judgeVerdictJsonSchema = {
  type: 'object',
  properties: {
    pass: { type: 'boolean' },
    reason: { type: 'string' },
  },
  required: ['pass', 'reason'],
}

const judgeRepairUserMessage =
  'Your last verdict did not parse as the required schema: exactly pass (boolean) and reason (string), no other top-level keys. '
  + 'Reply again matching that schema only. This applies to you as the judge, not to the Lore assistant response you graded.'

function normalizeText(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim()
}

function sanitizeForPathSegment(value) {
  return value.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'default'
}

function createOutputCollector() {
  const lines = []

  return {
    append(chunk) {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8')
      const entries = text.split(/\r?\n/).filter((line) => line.length > 0)
      lines.push(...entries)
      if (lines.length > 200) {
        lines.splice(0, lines.length - 200)
      }
    },
    toString() {
      return lines.join('\n')
    },
  }
}

function getRequestOptions(method, body) {
  const options = {
    method,
    headers: {},
    signal: AbortSignal.timeout(240_000),
  }

  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json'
    options.body = JSON.stringify(body)
  }

  return options
}

async function requestJson(baseUrl, path, method = 'GET', body) {
  const response = await fetch(`${baseUrl}${path}`, getRequestOptions(method, body))
  const data = await response.json()

  if (!response.ok || data.ok === false) {
    const errorMessage = typeof data.error === 'string'
      ? data.error
      : `Request failed with status ${response.status}`
    throw new Error(errorMessage)
  }

  return data
}

async function findOpenPort() {
  return await new Promise((resolvePort, reject) => {
    const probeServer = createServer()

    probeServer.once('error', reject)
    probeServer.listen(0, '127.0.0.1', () => {
      const address = probeServer.address()
      if (!address || typeof address === 'string') {
        probeServer.close(() => reject(new Error('Unable to determine an eval server port')))
        return
      }

      const { port } = address
      probeServer.close((error) => {
        if (error) {
          reject(error)
          return
        }

        resolvePort(port)
      })
    })
  })
}

async function waitForHealth(baseUrl, childProcess, outputCollector) {
  const deadline = Date.now() + 120_000

  while (Date.now() < deadline) {
    if (childProcess.exitCode !== null) {
      throw new Error(`Eval server exited early.\n${outputCollector.toString()}`)
    }

    try {
      await requestJson(baseUrl, '/health')
      return
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 1000))
    }
  }

  throw new Error(`Timed out waiting for the eval server.\n${outputCollector.toString()}`)
}

async function startEvalServer(config) {
  const port = await findOpenPort()
  const modelSlug = sanitizeForPathSegment(config.model)
  const userDataDirectory = config.userDataDirectory
    || join(tmpdir(), 'lore-promptfoo', `${modelSlug}-${randomUUID()}`)
  mkdirSync(userDataDirectory, { recursive: true })

  const outputCollector = createOutputCollector()
  const baseUrl = `http://127.0.0.1:${port}`
  const childProcess = spawn(
    electronPath,
    ['.'],
    {
      cwd: config.repositoryRoot,
      env: {
        ...process.env,
        LORE_RUNTIME_PROFILE: 'eval',
        LORE_ENABLE_EVAL_SERVER: '1',
        LORE_EVAL_SERVER_PORT: String(port),
        LORE_USER_DATA_DIR: userDataDirectory,
        LORE_SELECTED_MODEL: config.model,
        LORE_EMBEDDING_MODEL: config.embeddingModel,
        LORE_OLLAMA_HOST: config.ollamaHost,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )

  childProcess.stdout?.on('data', (chunk) => outputCollector.append(chunk))
  childProcess.stderr?.on('data', (chunk) => outputCollector.append(chunk))

  const cleanup = () => {
    if (childProcess.exitCode === null && !childProcess.killed) {
      childProcess.kill()
    }
  }

  process.once('exit', cleanup)
  process.once('SIGINT', cleanup)
  process.once('SIGTERM', cleanup)

  await waitForHealth(baseUrl, childProcess, outputCollector)

  return {
    childProcess,
    baseUrl,
    outputCollector,
  }
}

async function ensureEvalServer(config) {
  const serverKey = JSON.stringify({
    repositoryRoot: config.repositoryRoot,
    model: config.model,
    embeddingModel: config.embeddingModel,
    ollamaHost: config.ollamaHost,
  })

  const existingServer = activeServersByKey.get(serverKey)
  if (existingServer && existingServer.childProcess.exitCode === null) {
    return existingServer
  }

  const newServer = await startEvalServer(config)
  activeServersByKey.set(serverKey, newServer)
  return newServer
}

function countEvents(events, eventType) {
  return events.filter((event) => event.type === eventType).length
}

function getTodoContents(documents) {
  return documents.map((document) => document.content)
}

function includesNormalized(haystack, needle) {
  return normalizeText(haystack).includes(normalizeText(needle))
}

const judgeInvalidJsonReasonPrefix = 'Judge returned invalid JSON:'

function judgeMisattributesAssistantJsonRequirement(reason) {
  if (typeof reason !== 'string') {
    return false
  }
  const lower = reason.toLowerCase()
  const mentionsStructuredAssistantOutput =
    lower.includes('json object')
    || lower.includes('two keys')
    || lower.includes('\'pass\'')
    || lower.includes('"pass"')
    || lower.includes('code fence')
    || lower.includes('formatting requirement')
  const readsLikeAssistantFormatComplaint =
    lower.includes('assistant')
    || lower.includes('natural language')
    || lower.includes('conversational')
    || lower.includes('conversational text')
  return mentionsStructuredAssistantOutput && readsLikeAssistantFormatComplaint
}

function heuristicAssistantAsksForClarification(response) {
  const text = normalizeText(response)
  if (text.length < 12) {
    return false
  }

  const clarificationCues = [
    'which ',
    ' which ',
    'not sure which',
    "i'm not sure which",
    'not entirely sure',
    'could you let me know',
    'which one',
    'which one(s)',
    'which one should',
    'which specific',
    'which todo',
    'which ride',
    'which task',
    'which event',
    'which item',
    'which document',
    'clarify',
    'more specific',
    'disambiguat',
    'narrow down',
    'would you like to change',
    'would you like me to',
    'want me to',
    'do you mean',
    'did you mean',
    'are you referring to',
    'let me know which',
    'please specify',
    'please let me know',
    'there are multiple',
    'i found two',
    'i found three',
    'i found four',
    'i found multiple',
    'reply with a number',
    'pick a number',
    'just the option number',
    'paste the exact wording',
    'numbered candidates',
    '1, 2,',
    '2, or 3',
    'few ways you could',
  ]

  if (clarificationCues.some((cue) => text.includes(cue))) {
    return true
  }

  const hasNumberedList = /\b1[.)]\s+.+\n.*\b2[.)]\s+/.test(response)
  return hasNumberedList
}

/**
 * Some judge models confuse roles: they complain the Lore assistant should have returned JSON with pass/reason keys.
 * When that happens and the assistant clearly asked for clarification, treat the verdict as unreliable.
 */
function shouldIgnoreJudgeVerdictAfterJsonRoleConfusion(judgment, assistantResponse) {
  return (
    !judgment.pass
    && typeof judgment.reason === 'string'
    && judgeMisattributesAssistantJsonRequirement(judgment.reason)
    && heuristicAssistantAsksForClarification(assistantResponse)
  )
}

function hasExactNormalizedMatch(values, expectedValue) {
  const normalizedExpectedValue = normalizeText(expectedValue)
  return values.some((value) => normalizeText(value) === normalizedExpectedValue)
}

function getLatestRetrievedEvent(events) {
  return [...events].reverse().find((event) => event.type === 'retrieved') || null
}

function buildDocumentLookup(documents) {
  return new Map(documents.map((document) => [document.id, document]))
}

function mapRetrievedDocuments(retrievedEvent, documentLookup) {
  if (!retrievedEvent) {
    return []
  }

  return retrievedEvent.documentIds
    .map((documentId) => documentLookup.get(documentId))
    .filter((document) => document !== undefined)
}

/**
 * Native tool-loop transcripts sometimes record the final turn as protocol JSON
 * (`{"action":"reply","content":"..."}`). Judges and string rubrics should see the
 * user-visible `content` when present.
 */
function surfaceAssistantTextForEvaluation(rawResponse) {
  if (typeof rawResponse !== 'string') {
    return ''
  }
  const trimmed = rawResponse.trim()
  if (!trimmed.startsWith('{')) {
    return rawResponse
  }
  const parsed = safeJsonParse(trimmed)
  if (!parsed || typeof parsed !== 'object') {
    return rawResponse
  }
  if (parsed.action === 'reply' && typeof parsed.content === 'string') {
    return parsed.content
  }
  return rawResponse
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value)
  } catch {
    if (typeof value !== 'string') {
      return null
    }

    const normalizedValue = value.replace(/,\s*([}\]])/g, '$1')
    if (normalizedValue === value) {
      return null
    }

    try {
      return JSON.parse(normalizedValue)
    } catch {
      return null
    }
  }
}

/**
 * Maps common small-model judge shapes to { pass, reason }.
 * Only accepts unambiguous boolean + non-empty string pairs.
 */
function normalizeJudgeVerdict(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null
  }

  if (typeof parsed.pass === 'boolean' && typeof parsed.reason === 'string') {
    return { pass: parsed.pass, reason: parsed.reason }
  }

  const reasonKeyCandidates = [
    'reason',
    'source',
    'explanation',
    'rationale',
    'detail',
    'message',
    'justification',
  ]

  let resolvedPass = null
  if (typeof parsed.pass === 'boolean') {
    resolvedPass = parsed.pass
  } else if (typeof parsed.answer === 'boolean') {
    resolvedPass = parsed.answer
  } else if (typeof parsed.passed === 'boolean') {
    resolvedPass = parsed.passed
  } else if (typeof parsed.ok === 'boolean') {
    resolvedPass = parsed.ok
  } else if (typeof parsed.success === 'boolean') {
    resolvedPass = parsed.success
  } else if (typeof parsed.result === 'boolean') {
    resolvedPass = parsed.result
  } else if (typeof parsed.answer === 'string') {
    const normalizedAnswer = parsed.answer.toLowerCase().trim()
    if (normalizedAnswer === 'true' || normalizedAnswer === 'pass' || normalizedAnswer === 'yes') {
      resolvedPass = true
    } else if (normalizedAnswer === 'false' || normalizedAnswer === 'fail' || normalizedAnswer === 'no') {
      resolvedPass = false
    }
  }

  let resolvedReason = null
  for (const key of reasonKeyCandidates) {
    const candidate = parsed[key]
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      resolvedReason = candidate
      break
    }
  }

  if (resolvedPass !== null && resolvedReason !== null) {
    return { pass: resolvedPass, reason: resolvedReason }
  }

  return null
}

function parseJudgeResponse(content) {
  const raw = String(content || '').trim()
  const normalizedContent = stripMarkdownCodeFences(raw)
  const directParse = safeJsonParse(normalizedContent)
  const directVerdict = normalizeJudgeVerdict(directParse)
  if (directVerdict) {
    return directVerdict
  }

  const fenceBodies = extractMarkdownJsonFenceBodies(raw)
  for (const body of fenceBodies) {
    const slice = extractBalancedJsonObject(body) || body
    const parsed = safeJsonParse(slice)
    const verdict = normalizeJudgeVerdict(parsed)
    if (verdict) {
      return verdict
    }
  }

  const extractedJson = extractBalancedJsonObject(normalizedContent)
  if (!extractedJson) {
    return null
  }

  const extractedParse = safeJsonParse(extractedJson)
  const extractedVerdict = normalizeJudgeVerdict(extractedParse)
  if (extractedVerdict) {
    return extractedVerdict
  }

  return null
}

function stripMarkdownCodeFences(value) {
  return value
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
}

function extractMarkdownJsonFenceBodies(markdown) {
  const bodies = []
  const fencePattern = /```(?:json)?\s*([\s\S]*?)```/gi
  let match = fencePattern.exec(markdown)
  while (match !== null) {
    const body = match[1].trim()
    if (body.length > 0) {
      bodies.push(body)
    }
    match = fencePattern.exec(markdown)
  }
  return bodies
}

function parsedObjectMatchesStringFields(parsed, expectedFields) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return false
  }

  for (const [fieldKey, expectedFragment] of Object.entries(expectedFields)) {
    const candidateValue = parsed[fieldKey]
    if (candidateValue === undefined || candidateValue === null) {
      return false
    }
    if (!includesNormalized(String(candidateValue), String(expectedFragment))) {
      return false
    }
  }

  return true
}

function responseContainsCodeBlockJsonMatchingFields(responseText, expectedFields) {
  const fenceBodies = extractMarkdownJsonFenceBodies(String(responseText || ''))
  for (const body of fenceBodies) {
    const jsonSlice = extractBalancedJsonObject(body) || body
    const parsed = safeJsonParse(jsonSlice)
    if (!parsed) {
      continue
    }
    if (parsedObjectMatchesStringFields(parsed, expectedFields)) {
      return true
    }
  }

  const fallbackExtracted = extractBalancedJsonObject(String(responseText || '').trim())
  if (fallbackExtracted) {
    const parsed = safeJsonParse(fallbackExtracted)
    if (parsed && parsedObjectMatchesStringFields(parsed, expectedFields)) {
      return true
    }
  }

  return false
}

function extractBalancedJsonObject(value) {
  const startIndex = value.indexOf('{')
  if (startIndex === -1) {
    return null
  }

  let depth = 0
  let isInsideString = false
  let isEscaped = false

  for (let index = startIndex; index < value.length; index += 1) {
    const character = value[index]

    if (isInsideString) {
      if (isEscaped) {
        isEscaped = false
        continue
      }

      if (character === '\\') {
        isEscaped = true
        continue
      }

      if (character === '"') {
        isInsideString = false
      }

      continue
    }

    if (character === '"') {
      isInsideString = true
      continue
    }

    if (character === '{') {
      depth += 1
      continue
    }

    if (character === '}') {
      depth -= 1
      if (depth === 0) {
        return value.slice(startIndex, index + 1)
      }
    }
  }

  return null
}

function stringifyValue(value) {
  if (typeof value === 'string') {
    return value
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function buildRegexMatcher(regexExpectation) {
  if (typeof regexExpectation === 'string' && regexExpectation.length > 0) {
    return {
      regex: new RegExp(regexExpectation),
      description: regexExpectation,
    }
  }

  if (
    regexExpectation
    && typeof regexExpectation === 'object'
    && typeof regexExpectation.pattern === 'string'
    && regexExpectation.pattern.length > 0
  ) {
    return {
      regex: new RegExp(
        regexExpectation.pattern,
        typeof regexExpectation.flags === 'string' ? regexExpectation.flags : '',
      ),
      description: typeof regexExpectation.description === 'string' && regexExpectation.description.length > 0
        ? regexExpectation.description
        : regexExpectation.pattern,
    }
  }

  return null
}

function matchesRegex(regex, value) {
  regex.lastIndex = 0
  return regex.test(value)
}

function pushFailedCheck({
  failures,
  failedChecks,
  stepIndex,
  checkType,
  expected,
  actual,
  reason,
}) {
  failures.push(`Step ${stepIndex + 1}: ${reason}`)
  failedChecks.push({
    stepIndex,
    checkType,
    expected,
    actual,
    reason,
  })
}

function buildVisibleTranscript(interactionTurns) {
  return interactionTurns.flatMap((turn) => [
    { role: 'user', content: turn.userInput },
    { role: 'assistant', content: turn.response },
  ])
}

async function evaluateSimulatedUserFollowUp({
  scenarioTitle,
  stepIndex,
  simulatedUser,
  interactionTurns,
  judgeConfig,
  usedCandidateIds,
}) {
  const clarificationResponses = Array.isArray(simulatedUser?.clarificationResponses)
    ? simulatedUser.clarificationResponses
    : []

  if (clarificationResponses.length === 0 || interactionTurns.length === 0) {
    return {
      selectedCandidate: null,
      candidateEvaluations: [],
    }
  }

  const latestTurn = interactionTurns[interactionTurns.length - 1]
  const candidateEvaluations = []

  for (const clarificationResponse of clarificationResponses) {
    const responseId = clarificationResponse.id || clarificationResponse.userInput
    if (usedCandidateIds.has(responseId)) {
      continue
    }

    if (
      typeof clarificationResponse.triggerRubric !== 'string'
      || clarificationResponse.triggerRubric.trim().length === 0
      || typeof clarificationResponse.userInput !== 'string'
      || clarificationResponse.userInput.trim().length === 0
    ) {
      continue
    }

    const judgment = await judgeRubric({
      ...judgeConfig,
      rubric: clarificationResponse.triggerRubric,
      actualState: {
        scenarioTitle,
        stepIndex: stepIndex + 1,
        userGoal: simulatedUser.userGoal || '',
        latestAssistantResponse: latestTurn.response,
        visibleTranscript: buildVisibleTranscript(interactionTurns),
      },
    })

    candidateEvaluations.push({
      id: responseId,
      label: clarificationResponse.label || responseId,
      userInput: clarificationResponse.userInput,
      pass: judgment.pass,
      reason: judgment.reason,
    })
  }

  const matchingCandidates = candidateEvaluations.filter((candidateEvaluation) => candidateEvaluation.pass)

  if (matchingCandidates.length !== 1) {
    return {
      selectedCandidate: null,
      candidateEvaluations,
    }
  }

  const selectedCandidate = clarificationResponses.find((clarificationResponse) => {
    const responseId = clarificationResponse.id || clarificationResponse.userInput
    return responseId === matchingCandidates[0].id
  }) || null

  return {
    selectedCandidate,
    candidateEvaluations,
  }
}

async function judgeRubric({ judgeModel, ollamaHost, rubric, actualState }) {
  const initialUserContent = [
    'Apply the rubric to the actual state below.',
    '',
    `Rubric:\n${rubric}`,
    '',
    'Actual state:',
    JSON.stringify(actualState, null, 2),
  ].join('\n')

  let messages = [
    { role: 'system', content: judgeSystemPrompt },
    { role: 'user', content: initialUserContent },
  ]

  let lastRawContent = ''

  const maxJudgeAttempts = 5

  for (let attemptIndex = 0; attemptIndex < maxJudgeAttempts; attemptIndex += 1) {
    const schemaPayload = {
      model: judgeModel,
      stream: false,
      think: true,
      format: judgeVerdictJsonSchema,
      messages,
    }
    let judgeResponse = await fetch(`${ollamaHost}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(120_000),
      body: JSON.stringify(schemaPayload),
    })

    if (!judgeResponse.ok) {
      const fallbackPayload = { ...schemaPayload, format: 'json' }
      judgeResponse = await fetch(`${ollamaHost}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(120_000),
        body: JSON.stringify(fallbackPayload),
      })
    }

    if (!judgeResponse.ok) {
      const responseText = await judgeResponse.text().catch(() => judgeResponse.statusText)
      throw new Error(`Judge request failed: ${responseText}`)
    }

    const data = await judgeResponse.json()
    lastRawContent = data.message?.content ?? ''
    const parsed = parseJudgeResponse(lastRawContent)
    if (parsed) {
      return parsed
    }

    messages = [
      ...messages,
      { role: 'assistant', content: lastRawContent },
      { role: 'user', content: judgeRepairUserMessage },
    ]
  }

  return {
    pass: false,
    reason: `Judge returned invalid JSON: ${lastRawContent}`,
  }
}

async function evaluateClarificationExpectation({
  scenarioTitle,
  stepIndex,
  shouldRequireClarification,
  actualState,
  judgeConfig,
}) {
  const rubric = shouldRequireClarification
    ? clarificationRequiredRubric
    : 'The assistant must not ask the user for clarification or disambiguation.'

  const judgment = await judgeRubric({
    ...judgeConfig,
    rubric,
    actualState,
  })

  if (judgment.pass === shouldRequireClarification) {
    return []
  }

  if (
    shouldRequireClarification
    && typeof judgment.reason === 'string'
    && judgment.reason.startsWith(judgeInvalidJsonReasonPrefix)
    && heuristicAssistantAsksForClarification(actualState.response)
  ) {
    return []
  }

  if (shouldRequireClarification && shouldIgnoreJudgeVerdictAfterJsonRoleConfusion(judgment, actualState.response)) {
    return []
  }

  if (
    shouldRequireClarification
    && !judgment.pass
    && heuristicAssistantAsksForClarification(actualState.response)
  ) {
    return []
  }

  if (shouldRequireClarification) {
    return [`Step ${stepIndex + 1}: expected a clarification request in "${scenarioTitle}". Judge: ${judgment.reason}`]
  }

  return [`Step ${stepIndex + 1}: did not expect a clarification request in "${scenarioTitle}". Judge: ${judgment.reason}`]
}

async function evaluateInteractionClarificationExpectation({
  scenarioTitle,
  stepIndex,
  shouldRequireClarification,
  interactionTurns,
  judgeConfig,
}) {
  const rubric = clarificationRequiredRubric

  const turnJudgments = []
  for (const interactionTurn of interactionTurns) {
    const judgment = await judgeRubric({
      ...judgeConfig,
      rubric,
      actualState: {
        scenarioTitle,
        stepIndex: stepIndex + 1,
        userInput: interactionTurn.userInput,
        response: interactionTurn.response,
        visibleTranscript: buildVisibleTranscript([interactionTurn]),
      },
    })

    turnJudgments.push({
      userInput: interactionTurn.userInput,
      response: interactionTurn.response,
      pass: judgment.pass,
      reason: judgment.reason,
    })
  }

  const didAskForClarification = turnJudgments.some((turnJudgment) => turnJudgment.pass)

  return {
    didAskForClarification,
    turnJudgments,
    failures: didAskForClarification === shouldRequireClarification
      ? []
      : shouldRequireClarification
        ? [`Step ${stepIndex + 1}: expected the interaction to include a clarification request in "${scenarioTitle}".`]
        : [`Step ${stepIndex + 1}: did not expect the interaction to include a clarification request in "${scenarioTitle}".`],
  }
}

async function validateStepExpectations({
  scenarioTitle,
  stepIndex,
  step,
  actualState,
  judgeConfig,
}) {
  const failures = []
  const failedChecks = []
  const expect = step.expect || {}
  const normalizedResponse = normalizeText(actualState.response)
  const todoContents = actualState.todoContents
  const retrievedContents = actualState.retrievedContents

  if (Array.isArray(expect.responseIncludes)) {
    for (const expectedSnippet of expect.responseIncludes) {
      if (!includesNormalized(normalizedResponse, expectedSnippet)) {
        pushFailedCheck({
          failures,
          failedChecks,
          stepIndex,
          checkType: 'responseIncludes',
          expected: expectedSnippet,
          actual: actualState.response,
          reason: `expected response to include "${expectedSnippet}".`,
        })
      }
    }
  }

  if (Array.isArray(expect.responseExcludes)) {
    for (const forbiddenSnippet of expect.responseExcludes) {
      if (includesNormalized(normalizedResponse, forbiddenSnippet)) {
        pushFailedCheck({
          failures,
          failedChecks,
          stepIndex,
          checkType: 'responseExcludes',
          expected: `Response must exclude "${forbiddenSnippet}"`,
          actual: actualState.response,
          reason: `response unexpectedly included "${forbiddenSnippet}".`,
        })
      }
    }
  }

  if (Array.isArray(expect.responseMatchesRegex)) {
    for (const regexExpectation of expect.responseMatchesRegex) {
      const matcher = buildRegexMatcher(regexExpectation)
      if (!matcher) {
        continue
      }

      if (!matchesRegex(matcher.regex, actualState.response)) {
        pushFailedCheck({
          failures,
          failedChecks,
          stepIndex,
          checkType: 'responseMatchesRegex',
          expected: matcher.description,
          actual: actualState.response,
          reason: `expected response to match regex "${matcher.description}".`,
        })
      }
    }
  }

  if (
    expect.responseCodeBlockJsonIncludesFields
    && typeof expect.responseCodeBlockJsonIncludesFields === 'object'
    && !Array.isArray(expect.responseCodeBlockJsonIncludesFields)
  ) {
    const fieldEntries = Object.entries(expect.responseCodeBlockJsonIncludesFields).filter(
      (entry) => typeof entry[1] === 'string',
    )
    if (fieldEntries.length > 0) {
      const expectedFieldObject = Object.fromEntries(fieldEntries)
      if (!responseContainsCodeBlockJsonMatchingFields(actualState.response, expectedFieldObject)) {
        pushFailedCheck({
          failures,
          failedChecks,
          stepIndex,
          checkType: 'responseCodeBlockJsonIncludesFields',
          expected: expectedFieldObject,
          actual: actualState.response,
          reason: 'expected a markdown JSON code block (or raw JSON object) whose parsed fields include the expected string values (case and whitespace normalized).',
        })
      }
    }
  }

  if (Array.isArray(expect.responseExcludesRegex)) {
    for (const regexExpectation of expect.responseExcludesRegex) {
      const matcher = buildRegexMatcher(regexExpectation)
      if (!matcher) {
        continue
      }

      if (matchesRegex(matcher.regex, actualState.response)) {
        pushFailedCheck({
          failures,
          failedChecks,
          stepIndex,
          checkType: 'responseExcludesRegex',
          expected: `Response must not match regex "${matcher.description}"`,
          actual: actualState.response,
          reason: `response unexpectedly matched regex "${matcher.description}".`,
        })
      }
    }
  }

  if (typeof expect.requiresClarification === 'boolean') {
    const clarificationFailures = await evaluateClarificationExpectation({
      scenarioTitle,
      stepIndex,
      shouldRequireClarification: expect.requiresClarification,
      actualState,
      judgeConfig,
    })

    for (const failure of clarificationFailures) {
      pushFailedCheck({
        failures,
        failedChecks,
        stepIndex,
        checkType: 'requiresClarification',
        expected: expect.requiresClarification,
        actual: actualState.response,
        reason: failure.replace(/^Step\s+\d+:\s*/i, ''),
      })
    }
  }

  if (typeof expect.clarificationRequestedDuringInteraction === 'boolean') {
    const interactionClarificationResult = await evaluateInteractionClarificationExpectation({
      scenarioTitle,
      stepIndex,
      shouldRequireClarification: expect.clarificationRequestedDuringInteraction,
      interactionTurns: actualState.interactionTurns,
      judgeConfig,
    })

    for (const failure of interactionClarificationResult.failures) {
      pushFailedCheck({
        failures,
        failedChecks,
        stepIndex,
        checkType: 'clarificationRequestedDuringInteraction',
        expected: expect.clarificationRequestedDuringInteraction,
        actual: interactionClarificationResult.turnJudgments,
        reason: failure.replace(/^Step\s+\d+:\s*/i, ''),
      })
    }
  }

  if (typeof expect.storedCount === 'number') {
    const storedCount = countEvents(actualState.events, 'stored')
    if (storedCount !== expect.storedCount) {
      pushFailedCheck({
        failures,
        failedChecks,
        stepIndex,
        checkType: 'storedCount',
        expected: expect.storedCount,
        actual: storedCount,
        reason: `expected ${expect.storedCount} stored events but saw ${storedCount}.`,
      })
    }
  }

  if (typeof expect.deletedCount === 'number') {
    const deletedCount = countEvents(actualState.events, 'deleted')
    if (deletedCount !== expect.deletedCount) {
      pushFailedCheck({
        failures,
        failedChecks,
        stepIndex,
        checkType: 'deletedCount',
        expected: expect.deletedCount,
        actual: deletedCount,
        reason: `expected ${expect.deletedCount} deleted events but saw ${deletedCount}.`,
      })
    }
  }

  if (typeof expect.todoCount === 'number' && actualState.todoDocuments.length !== expect.todoCount) {
    pushFailedCheck({
      failures,
      failedChecks,
      stepIndex,
      checkType: 'todoCount',
      expected: expect.todoCount,
      actual: actualState.todoDocuments.length,
      reason: `expected ${expect.todoCount} todos but found ${actualState.todoDocuments.length}.`,
    })
  }

  if (typeof expect.retrievedCount === 'number' && actualState.retrievedCount !== expect.retrievedCount) {
    pushFailedCheck({
      failures,
      failedChecks,
      stepIndex,
      checkType: 'retrievedCount',
      expected: expect.retrievedCount,
      actual: actualState.retrievedCount,
      reason: `expected ${expect.retrievedCount} retrieved documents but saw ${actualState.retrievedCount}.`,
    })
  }

  if (typeof expect.minRetrievedCount === 'number' && actualState.retrievedCount < expect.minRetrievedCount) {
    pushFailedCheck({
      failures,
      failedChecks,
      stepIndex,
      checkType: 'minRetrievedCount',
      expected: expect.minRetrievedCount,
      actual: actualState.retrievedCount,
      reason: `expected at least ${expect.minRetrievedCount} retrieved documents but saw ${actualState.retrievedCount}.`,
    })
  }

  if (typeof expect.maxRetrievedCount === 'number' && actualState.retrievedCount > expect.maxRetrievedCount) {
    pushFailedCheck({
      failures,
      failedChecks,
      stepIndex,
      checkType: 'maxRetrievedCount',
      expected: expect.maxRetrievedCount,
      actual: actualState.retrievedCount,
      reason: `expected at most ${expect.maxRetrievedCount} retrieved documents but saw ${actualState.retrievedCount}.`,
    })
  }

  if (typeof expect.maxRetrievedCandidates === 'number' && actualState.totalCandidates > expect.maxRetrievedCandidates) {
    pushFailedCheck({
      failures,
      failedChecks,
      stepIndex,
      checkType: 'maxRetrievedCandidates',
      expected: expect.maxRetrievedCandidates,
      actual: actualState.totalCandidates,
      reason: `expected at most ${expect.maxRetrievedCandidates} retrieval candidates but saw ${actualState.totalCandidates}.`,
    })
  }

  if (Array.isArray(expect.todoContentsIncludeExact)) {
    for (const expectedTodo of expect.todoContentsIncludeExact) {
      if (!hasExactNormalizedMatch(todoContents, expectedTodo)) {
        pushFailedCheck({
          failures,
          failedChecks,
          stepIndex,
          checkType: 'todoContentsIncludeExact',
          expected: expectedTodo,
          actual: todoContents,
          reason: `expected todo "${expectedTodo}" to exist.`,
        })
      }
    }
  }

  if (Array.isArray(expect.todoContentsExcludeExact)) {
    for (const forbiddenTodo of expect.todoContentsExcludeExact) {
      if (hasExactNormalizedMatch(todoContents, forbiddenTodo)) {
        pushFailedCheck({
          failures,
          failedChecks,
          stepIndex,
          checkType: 'todoContentsExcludeExact',
          expected: `Todo list must exclude "${forbiddenTodo}"`,
          actual: todoContents,
          reason: `did not expect todo "${forbiddenTodo}" to exist.`,
        })
      }
    }
  }

  if (Array.isArray(expect.todoContentsIncludeSubstrings)) {
    for (const expectedSubstring of expect.todoContentsIncludeSubstrings) {
      const foundMatch = todoContents.some((todoContent) => includesNormalized(todoContent, expectedSubstring))
      if (!foundMatch) {
        pushFailedCheck({
          failures,
          failedChecks,
          stepIndex,
          checkType: 'todoContentsIncludeSubstrings',
          expected: expectedSubstring,
          actual: todoContents,
          reason: `expected a todo containing "${expectedSubstring}".`,
        })
      }
    }
  }

  if (Array.isArray(expect.todoContentsExcludeSubstrings)) {
    for (const forbiddenSubstring of expect.todoContentsExcludeSubstrings) {
      const foundMatch = todoContents.some((todoContent) => includesNormalized(todoContent, forbiddenSubstring))
      if (foundMatch) {
        pushFailedCheck({
          failures,
          failedChecks,
          stepIndex,
          checkType: 'todoContentsExcludeSubstrings',
          expected: `Todo list must exclude content containing "${forbiddenSubstring}"`,
          actual: todoContents,
          reason: `did not expect a todo containing "${forbiddenSubstring}".`,
        })
      }
    }
  }

  if (Array.isArray(expect.retrievedContentsIncludeSubstrings)) {
    for (const expectedSubstring of expect.retrievedContentsIncludeSubstrings) {
      const foundMatch = retrievedContents.some((retrievedContent) => includesNormalized(retrievedContent, expectedSubstring))
      if (!foundMatch) {
        pushFailedCheck({
          failures,
          failedChecks,
          stepIndex,
          checkType: 'retrievedContentsIncludeSubstrings',
          expected: expectedSubstring,
          actual: retrievedContents,
          reason: `expected retrieved content containing "${expectedSubstring}".`,
        })
      }
    }
  }

  if (Array.isArray(expect.retrievedContentsExcludeSubstrings)) {
    for (const forbiddenSubstring of expect.retrievedContentsExcludeSubstrings) {
      const foundMatch = retrievedContents.some((retrievedContent) => includesNormalized(retrievedContent, forbiddenSubstring))
      if (foundMatch) {
        pushFailedCheck({
          failures,
          failedChecks,
          stepIndex,
          checkType: 'retrievedContentsExcludeSubstrings',
          expected: `Retrieved content must exclude "${forbiddenSubstring}"`,
          actual: retrievedContents,
          reason: `did not expect retrieved content containing "${forbiddenSubstring}".`,
        })
      }
    }
  }

  if (typeof expect.responseJudge === 'string' && expect.responseJudge.trim().length > 0) {
    const judgment = await judgeRubric({
      ...judgeConfig,
      rubric: expect.responseJudge,
      actualState: {
        userInput: actualState.userInput,
        response: actualState.response,
      },
    })

    if (!judgment.pass && !shouldIgnoreJudgeVerdictAfterJsonRoleConfusion(judgment, actualState.response)) {
      pushFailedCheck({
        failures,
        failedChecks,
        stepIndex,
        checkType: 'responseJudge',
        expected: expect.responseJudge,
        actual: {
          userInput: actualState.userInput,
          response: actualState.response,
        },
        reason: `response judge failed: ${judgment.reason}`,
      })
    }
  }

  if (typeof expect.dataJudge === 'string' && expect.dataJudge.trim().length > 0) {
    const judgment = await judgeRubric({
      ...judgeConfig,
      rubric: expect.dataJudge,
      actualState: {
        userInput: actualState.userInput,
        response: actualState.response,
        todoDocuments: actualState.todoDocuments,
        allDocuments: actualState.allDocuments,
      },
    })

    if (!judgment.pass) {
      pushFailedCheck({
        failures,
        failedChecks,
        stepIndex,
        checkType: 'dataJudge',
        expected: expect.dataJudge,
        actual: {
          todoDocuments: actualState.todoDocuments,
          allDocuments: actualState.allDocuments,
        },
        reason: `data judge failed: ${judgment.reason}`,
      })
    }
  }

  if (typeof expect.retrievalJudge === 'string' && expect.retrievalJudge.trim().length > 0) {
    const judgment = await judgeRubric({
      ...judgeConfig,
      rubric: expect.retrievalJudge,
      actualState: {
        userInput: actualState.userInput,
        response: actualState.response,
        retrievedDocuments: actualState.retrievedDocuments,
        retrievedCount: actualState.retrievedCount,
        totalCandidates: actualState.totalCandidates,
      },
    })

    if (!judgment.pass) {
      pushFailedCheck({
        failures,
        failedChecks,
        stepIndex,
        checkType: 'retrievalJudge',
        expected: expect.retrievalJudge,
        actual: {
          retrievedDocuments: actualState.retrievedDocuments,
          retrievedCount: actualState.retrievedCount,
          totalCandidates: actualState.totalCandidates,
        },
        reason: `retrieval judge failed: ${judgment.reason}`,
      })
    }
  }

  return {
    failures,
    failedChecks,
  }
}

async function seedDocuments(evalServer, documents) {
  if (!Array.isArray(documents) || documents.length === 0) {
    return []
  }

  const result = await requestJson(evalServer.baseUrl, '/db/seed', 'POST', { documents })
  return result.documents || []
}

async function fetchStepState(evalServer, latestUserInput, messageResult, interactionTurns = []) {
  const allDocumentsResult = await requestJson(evalServer.baseUrl, '/db/documents')
  const todoResult = await requestJson(evalServer.baseUrl, '/db/documents?type=todo')
  const events = Array.isArray(messageResult.events) ? messageResult.events : []
  const allDocuments = Array.isArray(allDocumentsResult.documents) ? allDocumentsResult.documents : []
  const todoDocuments = Array.isArray(todoResult.documents) ? todoResult.documents : []
  const documentLookup = buildDocumentLookup(allDocuments)
  const retrievedEvent = getLatestRetrievedEvent(events)
  const retrievedDocuments = mapRetrievedDocuments(retrievedEvent, documentLookup)

  const pipelineTrace = Array.isArray(messageResult.pipelineTrace) ? messageResult.pipelineTrace : []
  const traceSchemaVersion = typeof messageResult.traceSchemaVersion === 'number'
    ? messageResult.traceSchemaVersion
    : 1

  return {
    userInput: latestUserInput,
    response: surfaceAssistantTextForEvaluation(messageResult.response || ''),
    events,
    allDocuments,
    todoDocuments,
    todoContents: getTodoContents(todoDocuments),
    retrievedDocumentIds: retrievedEvent?.documentIds || [],
    retrievedDocuments,
    retrievedContents: retrievedDocuments.map((document) => document.content),
    retrievedCount: typeof retrievedEvent?.totalRetrieved === 'number'
      ? retrievedEvent.totalRetrieved
      : retrievedDocuments.length,
    totalCandidates: typeof retrievedEvent?.totalCandidates === 'number'
      ? retrievedEvent.totalCandidates
      : retrievedDocuments.length,
    cutoffScore: typeof retrievedEvent?.cutoffScore === 'number' ? retrievedEvent.cutoffScore : null,
    interactionTurns,
    pipelineTrace,
    traceSchemaVersion,
  }
}

async function runScenarioStep({
  evalServer,
  scenario,
  step,
  stepIndex,
  judgeConfig,
}) {
  if (step.clearConversationBeforeStep === true) {
    await requestJson(evalServer.baseUrl, '/conversation/reset', 'POST')
  }

  await seedDocuments(evalServer, step.seedDocuments)

  const interactionTurns = []
  const usedCandidateIds = new Set()
  const simulatedUser = step.simulatedUser || null
  const maxAssistantTurns = Number.isInteger(simulatedUser?.maxAssistantTurns)
    ? simulatedUser.maxAssistantTurns
    : 3

  let latestUserInput = step.userInput
  let messageResult = null

  for (let assistantTurnIndex = 0; assistantTurnIndex < maxAssistantTurns; assistantTurnIndex += 1) {
    messageResult = await requestJson(evalServer.baseUrl, '/agent/message', 'POST', {
      message: latestUserInput,
    })

    const turnState = await fetchStepState(evalServer, latestUserInput, messageResult)
    interactionTurns.push({
      turnIndex: assistantTurnIndex,
      userInput: turnState.userInput,
      response: turnState.response,
      events: turnState.events,
      todoContents: turnState.todoContents,
      retrievedDocumentIds: turnState.retrievedDocumentIds,
      retrievedContents: turnState.retrievedContents,
      retrievedCount: turnState.retrievedCount,
      totalCandidates: turnState.totalCandidates,
      cutoffScore: turnState.cutoffScore,
      pipelineTrace: turnState.pipelineTrace,
      traceSchemaVersion: turnState.traceSchemaVersion,
      simulatedUserDecision: null,
    })

    if (!simulatedUser) {
      break
    }

    const { selectedCandidate, candidateEvaluations } = await evaluateSimulatedUserFollowUp({
      scenarioTitle: scenario.title,
      stepIndex,
      simulatedUser,
      interactionTurns,
      judgeConfig,
      usedCandidateIds,
    })

    interactionTurns[interactionTurns.length - 1].simulatedUserDecision = {
      candidateEvaluations,
      selectedResponseId: selectedCandidate?.id || selectedCandidate?.userInput || null,
      selectedUserInput: selectedCandidate?.userInput || null,
    }

    if (!selectedCandidate) {
      break
    }

    usedCandidateIds.add(selectedCandidate.id || selectedCandidate.userInput)
    latestUserInput = selectedCandidate.userInput
  }

  const finalMessageResult = messageResult || { response: '', events: [] }
  const finalState = await fetchStepState(
    evalServer,
    latestUserInput,
    finalMessageResult,
    interactionTurns,
  )
  const stepValidation = await validateStepExpectations({
    scenarioTitle: scenario.title,
    stepIndex,
    step,
    actualState: finalState,
    judgeConfig,
  })

  return {
    finalState,
    failures: stepValidation.failures,
    failedChecks: stepValidation.failedChecks,
    transcriptEntry: {
      stepIndex,
      initialUserInput: step.userInput,
      finalUserInput: finalState.userInput,
      response: finalState.response,
      events: finalState.events,
      todoContents: finalState.todoContents,
      retrievedDocumentIds: finalState.retrievedDocumentIds,
      retrievedContents: finalState.retrievedContents,
      retrievedCount: finalState.retrievedCount,
      totalCandidates: finalState.totalCandidates,
      cutoffScore: finalState.cutoffScore,
      interactionTurns,
      failedChecks: stepValidation.failedChecks,
      librarySnapshot: {
        allDocuments: finalState.allDocuments,
        todoDocuments: finalState.todoDocuments,
      },
    },
  }
}

async function runScenario(evalServer, scenario, judgeConfig) {
  await requestJson(evalServer.baseUrl, '/reset', 'POST')
  await seedDocuments(evalServer, scenario.seedDocuments)

  const transcript = []
  const failures = []
  const failedChecks = []

  for (let stepIndex = 0; stepIndex < scenario.steps.length; stepIndex += 1) {
    const step = scenario.steps[stepIndex]
    const stepResult = await runScenarioStep({
      evalServer,
      scenario,
      step,
      stepIndex,
      judgeConfig,
    })

    failures.push(...stepResult.failures)
    failedChecks.push(...stepResult.failedChecks)
    transcript.push(stepResult.transcriptEntry)
  }

  const finalTodoResult = await requestJson(evalServer.baseUrl, '/db/documents?type=todo')

  return {
    passed: failures.length === 0,
    failures,
    failedChecks,
    transcript,
    finalTodos: finalTodoResult.documents || [],
  }
}

export default class LoreScenarioProvider {
  constructor(options = {}) {
    this.providerId = options.id || 'lore-scenario'
    this.config = options.config || {}
  }

  id() {
    return this.providerId
  }

  async callApi(_prompt, context = {}) {
    const scenarioId = context?.vars?.scenarioId
    if (typeof scenarioId !== 'string' || scenarioId.length === 0) {
      return {
        error: 'Missing scenarioId test variable.',
        metadata: { passed: false },
      }
    }

    const scenario = getScenarioById(scenarioId)
    if (!scenario) {
      return {
        error: `Unknown scenario "${scenarioId}".`,
        metadata: { passed: false, scenarioId },
      }
    }

    const repositoryRoot = this.config.repositoryRoot || defaultRepositoryRoot
    const ollamaHost = this.config.ollamaHost || 'http://127.0.0.1:11434'
    const embeddingModel = this.config.embeddingModel || 'nomic-embed-text'

    try {
      const evalServer = await ensureEvalServer({
        repositoryRoot,
        model: this.config.model,
        embeddingModel,
        ollamaHost,
      })

      const scenarioResult = await runScenario(evalServer, scenario, {
        judgeModel: this.config.judgeModel || this.config.model,
        ollamaHost,
      })

      const transcriptSteps = scenarioResult.transcript || []
      let lastPipelineTracePayload = null
      if (transcriptSteps.length > 0) {
        const lastStep = transcriptSteps[transcriptSteps.length - 1]
        const turns = Array.isArray(lastStep?.interactionTurns) ? lastStep.interactionTurns : []
        if (turns.length > 0) {
          const lastTurn = turns[turns.length - 1]
          lastPipelineTracePayload = {
            traceSchemaVersion: typeof lastTurn.traceSchemaVersion === 'number' ? lastTurn.traceSchemaVersion : 1,
            stages: Array.isArray(lastTurn.pipelineTrace) ? lastTurn.pipelineTrace : [],
          }
        }
      }

      const summary = scenarioResult.passed
        ? `Passed: ${scenario.title}`
        : `Failed: ${scenario.title} (${scenarioResult.failures.length} issue${scenarioResult.failures.length === 1 ? '' : 's'})`

      return {
        output: summary,
        metadata: {
          passed: scenarioResult.passed,
          summary,
          scenarioId: scenario.id,
          scenarioTitle: scenario.title,
          model: this.config.model,
          judgeModel: this.config.judgeModel || this.config.model,
          failures: scenarioResult.failures,
          failedChecks: scenarioResult.failedChecks,
          transcript: scenarioResult.transcript,
          finalTodos: scenarioResult.finalTodos,
          evalServerOutput: evalServer.outputCollector.toString(),
          lastPipelineTrace: lastPipelineTracePayload,
        },
      }
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
        metadata: {
          passed: false,
          scenarioId,
          model: this.config.model,
          judgeModel: this.config.judgeModel || this.config.model,
        },
      }
    }
  }
}
