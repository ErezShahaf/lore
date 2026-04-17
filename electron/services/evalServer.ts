import { app } from 'electron'
import { randomUUID } from 'crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { URL } from 'url'
import { logger } from '../logger'
import { embedTexts } from './embeddingService'
import { clearConversation, getConversationHistory, getLastPipelineTrace, processUserInput } from './agentService'
import { formatLocalDate } from './localDate'
import { getAllDocuments, getDocumentsByType, getStats, insertDocuments, resetTable } from './lanceService'
import { ensureDocumentsTableMatchesEmbeddingModel } from './embeddingTableSync'
import { getSettings, updateSettings } from './settingsService'
import {
  PIPELINE_TRACE_SCHEMA_VERSION,
  type AgentEvent,
  type AppSettings,
  type DocumentType,
  type LoreDocument,
  type PipelineStageRecord,
} from '../../shared/types'

const EVAL_SERVER_ENABLE_ENV = 'LORE_ENABLE_EVAL_SERVER'
const EVAL_SERVER_PORT_ENV = 'LORE_EVAL_SERVER_PORT'

let activeServer: Server | null = null

function isEvalServerEnabled(): boolean {
  return process.env[EVAL_SERVER_ENABLE_ENV] === '1'
}

function resolveEvalServerPort(): number {
  const rawPort = process.env[EVAL_SERVER_PORT_ENV]
  const parsedPort = rawPort ? Number.parseInt(rawPort, 10) : NaN

  if (!Number.isInteger(parsedPort) || parsedPort <= 0) {
    throw new Error(`Missing or invalid ${EVAL_SERVER_PORT_ENV}`)
  }

  return parsedPort
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  if (chunks.length === 0) {
    return {}
  }

  const body = Buffer.concat(chunks).toString('utf-8').trim()
  if (body.length === 0) {
    return {}
  }

  const parsed: unknown = JSON.parse(body)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected a JSON object body')
  }

  return parsed as Record<string, unknown>
}

function sanitizeDocument(document: LoreDocument): Omit<LoreDocument, 'vector'> {
  const { vector: _vector, ...documentWithoutVector } = document
  // Explicitly mark the destructured vector as intentionally unused.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  void _vector
  return documentWithoutVector
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

function isDocumentType(value: unknown): value is DocumentType {
  return value === 'thought'
    || value === 'todo'
    || value === 'instruction'
    || value === 'meeting'
    || value === 'note'
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

interface EvalSeedDocumentInput {
  readonly content: string
  readonly type: DocumentType
  readonly date: string
  readonly tags: readonly string[]
  readonly source: string
  readonly metadata: Record<string, unknown>
  readonly isDeleted: boolean
}

function normalizeSeedDocuments(body: Record<string, unknown>): EvalSeedDocumentInput[] {
  const documents = body.documents
  if (!Array.isArray(documents)) {
    throw new Error('Expected "documents" to be an array.')
  }

  const today = formatLocalDate(new Date())

  return documents.map((document, index) => {
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
      throw new Error(`Seed document at index ${index} must be an object.`)
    }

    const content = document.content
    if (!isString(content) || content.trim().length === 0) {
      throw new Error(`Seed document at index ${index} requires a non-empty "content" string.`)
    }

    const type = isDocumentType(document.type) ? document.type : 'thought'
    const date = isString(document.date) && document.date.length > 0 ? document.date : today
    const tags = isStringArray(document.tags) ? document.tags : []
    const source = isString(document.source) && document.source.length > 0 ? document.source : 'eval-seed'
    const metadata = document.metadata && typeof document.metadata === 'object' && !Array.isArray(document.metadata)
      ? document.metadata as Record<string, unknown>
      : {}

    return {
      content,
      type,
      date,
      tags,
      source,
      metadata,
      isDeleted: isBoolean(document.isDeleted) ? document.isDeleted : false,
    }
  })
}

async function seedDocumentsForEval(inputs: readonly EvalSeedDocumentInput[]): Promise<readonly Omit<LoreDocument, 'vector'>[]> {
  if (inputs.length === 0) {
    return []
  }

  const vectors = await embedTexts(inputs.map((input) => input.content))
  const now = new Date().toISOString()

  const documents: LoreDocument[] = inputs.map((input, index) => ({
    id: randomUUID(),
    content: input.content,
    vector: vectors[index],
    type: input.type,
    createdAt: now,
    updatedAt: now,
    date: input.date,
    tags: input.tags.join(','),
    source: input.source,
    metadata: JSON.stringify(input.metadata),
    isDeleted: input.isDeleted,
  }))

  await insertDocuments(documents)
  return documents.map(sanitizeDocument)
}

function parseSettingsUpdate(body: Record<string, unknown>): Partial<AppSettings> {
  const settingsUpdate: Partial<AppSettings> = {}

  if (isString(body.selectedModel)) {
    settingsUpdate.selectedModel = body.selectedModel
  }

  if (isString(body.embeddingModel)) {
    settingsUpdate.embeddingModel = body.embeddingModel
  }

  if (isString(body.ollamaHost)) {
    settingsUpdate.ollamaHost = body.ollamaHost
  }

  if (
    typeof body.ollamaKeepAliveMinutes === 'number' &&
    Number.isInteger(body.ollamaKeepAliveMinutes) &&
    body.ollamaKeepAliveMinutes >= -1 &&
    body.ollamaKeepAliveMinutes <= 10_080
  ) {
    settingsUpdate.ollamaKeepAliveMinutes = body.ollamaKeepAliveMinutes
  }

  if (isBoolean(body.ollamaSetupComplete)) {
    settingsUpdate.ollamaSetupComplete = body.ollamaSetupComplete
  }

  return settingsUpdate
}

async function collectAgentEvents(message: string): Promise<{
  readonly events: AgentEvent[]
  readonly response: string
  readonly pipelineTrace: readonly PipelineStageRecord[]
  readonly traceSchemaVersion: number
}> {
  const events: AgentEvent[] = []
  let response = ''

  for await (const event of processUserInput(message)) {
    events.push(event)

    if (event.type === 'chunk') {
      response += event.content
    }
  }

  const storedTrace = getLastPipelineTrace()
  return {
    events,
    response,
    pipelineTrace: storedTrace?.stages ?? [],
    traceSchemaVersion: storedTrace?.traceSchemaVersion ?? PIPELINE_TRACE_SCHEMA_VERSION,
  }
}

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const method = request.method ?? 'GET'
  const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')

  if (method === 'GET' && requestUrl.pathname === '/health') {
    writeJson(response, 200, {
      ok: true,
      profile: process.env.LORE_ACTIVE_RUNTIME_PROFILE ?? 'unknown',
      userDataPath: app.getPath('userData'),
      settings: getSettings(),
    })
    return
  }

  if (method === 'POST' && requestUrl.pathname === '/reset') {
    clearConversation()
    await resetTable()
    writeJson(response, 200, { ok: true })
    return
  }

  if (method === 'POST' && requestUrl.pathname === '/conversation/reset') {
    clearConversation()
    writeJson(response, 200, { ok: true })
    return
  }

  if (method === 'POST' && requestUrl.pathname === '/db/seed') {
    const body = await readJsonBody(request)
    const seedDocuments = normalizeSeedDocuments(body)
    const documents = await seedDocumentsForEval(seedDocuments)
    writeJson(response, 200, {
      ok: true,
      insertedCount: documents.length,
      documents,
    })
    return
  }

  if (method === 'POST' && requestUrl.pathname === '/settings/update') {
    const body = await readJsonBody(request)
    const previousSettings = getSettings()
    const settingsUpdate = parseSettingsUpdate(body)
    const updatedSettings = updateSettings(settingsUpdate)

    if (
      settingsUpdate.embeddingModel !== undefined
      && settingsUpdate.embeddingModel !== previousSettings.embeddingModel
    ) {
      // Align the LanceDB schema with the new model via the same reconciler
      // the production flows use, so evals exercise the real migration path.
      // The eval harness seeds fresh data per scenario, so this typically
      // resolves to an empty-table reset.
      await ensureDocumentsTableMatchesEmbeddingModel({
        previousModelName: previousSettings.embeddingModel,
        newModelName: settingsUpdate.embeddingModel,
      })
      clearConversation()
    }

    writeJson(response, 200, { ok: true, settings: updatedSettings })
    return
  }

  if (method === 'POST' && requestUrl.pathname === '/agent/message') {
    const body = await readJsonBody(request)
    const message = body.message

    if (!isString(message) || message.trim().length === 0) {
      writeJson(response, 400, { ok: false, error: 'A non-empty "message" string is required.' })
      return
    }

    const result = await collectAgentEvents(message)
    writeJson(response, 200, { ok: true, ...result })
    return
  }

  if (method === 'GET' && requestUrl.pathname === '/db/stats') {
    writeJson(response, 200, { ok: true, stats: await getStats() })
    return
  }

  if (method === 'GET' && requestUrl.pathname === '/db/documents') {
    const requestedType = requestUrl.searchParams.get('type')
    const documents = isDocumentType(requestedType)
      ? await getDocumentsByType(requestedType)
      : await getAllDocuments(false)

    writeJson(response, 200, {
      ok: true,
      documents: documents.map(sanitizeDocument),
    })
    return
  }

  if (method === 'GET' && requestUrl.pathname === '/conversation/history') {
    writeJson(response, 200, {
      ok: true,
      history: getConversationHistory(),
    })
    return
  }

  writeJson(response, 404, { ok: false, error: 'Endpoint not found.' })
}

export async function startEvalServer(): Promise<void> {
  if (!isEvalServerEnabled()) {
    return
  }

  if (activeServer) {
    return
  }

  const port = resolveEvalServerPort()

  activeServer = createServer((request, response) => {
    handleRequest(request, response).catch((error: unknown) => {
      logger.error({ error }, '[EvalServer] Request failed')
      writeJson(response, 500, {
        ok: false,
        error: error instanceof Error ? error.message : 'Unexpected eval server error',
      })
    })
  })

  await new Promise<void>((resolve, reject) => {
    activeServer!.once('error', reject)
    activeServer!.listen(port, '127.0.0.1', () => {
      activeServer!.off('error', reject)
      resolve()
    })
  })

  logger.info({ port, userDataPath: app.getPath('userData') }, '[EvalServer] Listening')
}

export async function stopEvalServer(): Promise<void> {
  if (!activeServer) {
    return
  }

  const serverToStop = activeServer
  activeServer = null

  await new Promise<void>((resolve, reject) => {
    serverToStop.close((error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })
}
