import { getSettings } from './settingsService'
import { logger } from '../logger'
import type {
  OllamaModel,
  ChatRequest,
  PullProgress,
  OllamaStatus,
  ChatRequestOptions,
  ToolChatRequest,
  ToolChatResponse,
  ToolChatMessage,
  ToolCall,
} from '../../shared/types'

export const CHAT_NUM_CTX = 8192

export interface ChatPromptMessage {
  readonly role: 'system' | 'user' | 'assistant'
  readonly content: string
}

interface StructuredResponseRequest<T> {
  readonly model: string
  readonly messages: readonly ChatPromptMessage[]
  readonly schema: Record<string, unknown>
  readonly validate: (parsed: Record<string, unknown>) => T
  readonly maxAttempts?: number
  readonly think?: boolean
  readonly options?: ChatRequestOptions
}

let connectionStatus: OllamaStatus = { connected: false }
let healthCheckTimer: ReturnType<typeof setInterval> | null = null

function getHost(): string {
  return getSettings().ollamaHost || 'http://127.0.0.1:11434'
}

export async function checkConnection(): Promise<OllamaStatus> {
  try {
    const res = await fetch(`${getHost()}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    })
    connectionStatus = { connected: res.ok }
  } catch {
    connectionStatus = { connected: false, error: 'Ollama is not running' }
  }
  return connectionStatus
}

export function getConnectionStatus(): OllamaStatus {
  return connectionStatus
}

export function startHealthCheck(onStatusChange?: (status: OllamaStatus) => void): void {
  stopHealthCheck()

  const check = async () => {
    const prev = connectionStatus.connected
    await checkConnection()
    if (connectionStatus.connected !== prev) {
      onStatusChange?.(connectionStatus)
    }
  }

  check()
  healthCheckTimer = setInterval(check, 30_000)
}

export function stopHealthCheck(): void {
  if (healthCheckTimer) {
    clearInterval(healthCheckTimer)
    healthCheckTimer = null
  }
}

export async function listModels(): Promise<OllamaModel[]> {
  const res = await fetch(`${getHost()}/api/tags`, {
    signal: AbortSignal.timeout(10_000),
  })

  if (!res.ok) throw new Error(`Failed to list models: ${res.statusText}`)

  const data = await res.json()
  return (data.models ?? []).map((m: Record<string, unknown>) => ({
    name: m.name as string,
    modifiedAt: m.modified_at as string,
    size: m.size as number,
    digest: m.digest as string,
  }))
}

export async function preloadModels(): Promise<void> {
  const settings = getSettings()
  const host = getHost()

  const chatModel = settings.selectedModel
  const embedModel = settings.embeddingModel || 'nomic-embed-text'

  const jobs: Promise<void>[] = []

  if (chatModel) {
    jobs.push(
      fetch(`${host}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: chatModel,
          messages: [],
          keep_alive: -1,
          think: false,
          options: { num_ctx: CHAT_NUM_CTX },
        }),
        signal: AbortSignal.timeout(120_000),
      })
        .then((res) => {
          if (res.ok) logger.info({ chatModel }, '[Lore] Preloaded chat model')
          else logger.warn({ chatModel, status: res.statusText }, '[Lore] Failed to preload chat model')
        })
        .catch((err) => logger.warn({ err, chatModel }, '[Lore] Failed to preload chat model')),
    )
  }

  if (embedModel) {
    jobs.push(
      fetch(`${host}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: embedModel,
          input: '',
          keep_alive: -1,
        }),
        signal: AbortSignal.timeout(120_000),
      })
        .then((res) => {
          if (res.ok) logger.info({ embedModel }, '[Lore] Preloaded embedding model')
          else logger.warn({ embedModel, status: res.statusText }, '[Lore] Failed to preload embedding model')
        })
        .catch((err) => logger.warn({ err, embedModel }, '[Lore] Failed to preload embedding model')),
    )
  }

  await Promise.allSettled(jobs)
}

const activeAbortControllers = new Map<string, AbortController>()

export function abortPull(modelName: string): boolean {
  const controller = activeAbortControllers.get(modelName)
  if (controller) {
    controller.abort()
    activeAbortControllers.delete(modelName)
    return true
  }
  return false
}

export async function pullModel(
  modelName: string,
  onProgress: (progress: PullProgress) => void,
): Promise<void> {
  const controller = new AbortController()
  activeAbortControllers.set(modelName, controller)

  const res = await fetch(`${getHost()}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: modelName, stream: true }),
    signal: controller.signal,
  })

  if (!res.ok) throw new Error(`Failed to pull model: ${res.statusText}`)
  if (!res.body) throw new Error('No response body')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    let done = false
    while (!done) {
      const result = await reader.read()
      done = result.done
      const value = result.value

      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const json = JSON.parse(line)
          onProgress({
            status: json.status ?? '',
            digest: json.digest,
            total: json.total,
            completed: json.completed,
          })
        } catch {
          // skip malformed lines
        }
      }
    }
  } finally {
    activeAbortControllers.delete(modelName)
  }
}

export async function deleteModel(modelName: string): Promise<void> {
  const res = await fetch(`${getHost()}/api/delete`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: modelName }),
  })

  if (!res.ok) throw new Error(`Failed to delete model: ${res.statusText}`)
}

export async function getModelInfo(modelName: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${getHost()}/api/show`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: modelName }),
  })

  if (!res.ok) throw new Error(`Failed to get model info: ${res.statusText}`)
  return res.json()
}

export async function* chat(request: ChatRequest): AsyncGenerator<string> {
  const payload = {
    keep_alive: -1,
    ...request,
    options: { num_ctx: CHAT_NUM_CTX, ...request.options },
  }
  const res = await fetch(`${getHost()}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120_000),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`Ollama chat failed: ${text}`)
  }

  if (!request.stream) {
    const data = await res.json()
    yield data.message?.content ?? ''
    return
  }

  if (!res.body) throw new Error('No response body for streaming')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const json = JSON.parse(line)
        if (json.message?.content) {
          yield json.message.content
        }
      } catch {
        // skip malformed lines
      }
    }
  }
}

function normalizeOllamaAssistantTextField(raw: unknown): string {
  if (raw === null || raw === undefined) {
    return ''
  }
  if (typeof raw === 'string') {
    return raw
  }
  if (Array.isArray(raw)) {
    return raw
      .map((part: unknown) => {
        if (typeof part === 'string') {
          return part
        }
        if (part && typeof part === 'object' && 'text' in part) {
          const text = (part as { readonly text: unknown }).text
          return typeof text === 'string' ? text : ''
        }
        return ''
      })
      .join('')
  }
  return ''
}

function appendStreamAssistantTextDeltas(
  messageRecord: Record<string, unknown>,
  accumulated: { readonly content: { value: string }; readonly thinking: { value: string } },
): void {
  const contentDelta = messageRecord.content
  if (typeof contentDelta === 'string') {
    accumulated.content.value += contentDelta
  }
  const thinkingDelta = messageRecord.thinking
  if (typeof thinkingDelta === 'string') {
    accumulated.thinking.value += thinkingDelta
  }
}

function parseToolArguments(raw: unknown): Record<string, unknown> {
  if (raw === null || raw === undefined) {
    return {}
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (trimmed.length === 0) {
      return {}
    }
    try {
      const parsed = JSON.parse(trimmed) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      return {}
    }
    return {}
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>
  }
  return {}
}


function parseToolChatMessage(message: Record<string, unknown>): ToolChatMessage {
  const role = ((message.role as string) || 'assistant') as ToolChatMessage['role']
  const content = normalizeOllamaAssistantTextField(message.content)
  const rawToolCalls = message.tool_calls as ReadonlyArray<Record<string, unknown>> | undefined

  let toolCalls: readonly ToolCall[] | undefined = rawToolCalls?.map((call) => {
    const func = (call.function as Record<string, unknown>) ?? {}
    return {
      function: {
        name: func.name as string,
        arguments: parseToolArguments(func.arguments),
      },
    }
  })

  return {
    role,
    content,
    ...(toolCalls && toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
  }
}

/**
 * Splits assistant text into small pieces so the UI can append them sequentially (typing effect).
 */
export function splitForTypingEffect(text: string): readonly string[] {
  if (text.length === 0) {
    return []
  }
  return text.split(/(\s+)/).filter((part) => part.length > 0)
}

export async function chatWithTools(request: ToolChatRequest): Promise<ToolChatResponse> {
  const payload = {
    model: request.model,
    messages: request.messages,
    tools: request.tools,
    stream: false,
    keep_alive: -1,
    options: { num_ctx: CHAT_NUM_CTX, ...request.options },
  }

  const res = await fetch(`${getHost()}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120_000),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`Ollama chat failed: ${text}`)
  }

  const data = await res.json() as Record<string, unknown>
  const message = data.message as Record<string, unknown> | undefined

  if (!message || typeof message !== 'object') {
    throw new Error('Ollama response missing message field')
  }

  const responseMessage = parseToolChatMessage(message)
  const hasToolCalls = responseMessage.tool_calls && responseMessage.tool_calls.length > 0
  const hasContent = responseMessage.content.trim().length > 0

  logger.debug(
    {
      hasContent,
      contentLength: responseMessage.content.length,
      contentPreview: responseMessage.content.slice(0, 100),
      hasToolCalls,
      toolCallCount: responseMessage.tool_calls?.length ?? 0,
      rawContentType: typeof message.content,
      rawContentIsArray: Array.isArray(message.content),
      rawThinkingPresent: message.thinking !== undefined && message.thinking !== null,
      rawThinkingLength: typeof message.thinking === 'string' ? message.thinking.length : Array.isArray(message.thinking) ? JSON.stringify(message.thinking).length : 0,
    },
    '[Ollama] chatWithTools response',
  )

  if (!hasContent && !hasToolCalls) {
    logger.warn(
      {
        rawMessageKeys: Object.keys(message),
        rawContent: JSON.stringify(message.content)?.slice(0, 500),
        rawThinking: typeof message.thinking === 'string' ? message.thinking.slice(0, 300) : JSON.stringify(message.thinking)?.slice(0, 500),
      },
      '[Ollama] Model returned empty content with no tool calls',
    )
  }

  return { message: responseMessage }
}

/**
 * Streams a tool-enabled chat round. Waits for the final `done` line so we never show partial
 * assistant text when the model actually chose tool_calls. For plain text replies, replays the
 * final content in word-sized chunks for the typing effect.
 */
export async function* streamChatWithTools(
  request: ToolChatRequest,
): AsyncGenerator<ToolChatMessage> {
  const payload = {
    model: request.model,
    messages: request.messages,
    tools: request.tools,
    stream: true,
    think: false,
    keep_alive: -1,
    options: { num_ctx: CHAT_NUM_CTX, ...request.options },
  }

  const res = await fetch(`${getHost()}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120_000),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`Ollama chat failed: ${text}`)
  }

  if (!res.body) {
    throw new Error('No response body for streaming')
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let lineBuffer = ''
  const accumulated = {
    content: { value: '' },
    thinking: { value: '' },
  }
  let lastDoneMessage: Record<string, unknown> | null = null

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }

    lineBuffer += decoder.decode(value, { stream: true })
    const lines = lineBuffer.split('\n')
    lineBuffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.trim()) {
        continue
      }
      try {
        const json = JSON.parse(line) as Record<string, unknown>
        const rawMessage = json.message
        if (rawMessage && typeof rawMessage === 'object' && !Array.isArray(rawMessage)) {
          appendStreamAssistantTextDeltas(rawMessage as Record<string, unknown>, accumulated)
        }
        if (json.done === true && json.message && typeof json.message === 'object') {
          lastDoneMessage = json.message as Record<string, unknown>
        }
      } catch {
        // skip malformed lines
      }
    }
  }

  if (lineBuffer.trim()) {
    try {
      const json = JSON.parse(lineBuffer) as Record<string, unknown>
      const rawMessage = json.message
      if (rawMessage && typeof rawMessage === 'object' && !Array.isArray(rawMessage)) {
        appendStreamAssistantTextDeltas(rawMessage as Record<string, unknown>, accumulated)
      }
      if (json.done === true && json.message && typeof json.message === 'object') {
        lastDoneMessage = json.message as Record<string, unknown>
      }
    } catch {
      // ignore trailing garbage
    }
  }

  if (!lastDoneMessage) {
    throw new Error('Ollama streaming response ended without a done message')
  }

  const contentFromDone = normalizeOllamaAssistantTextField(lastDoneMessage.content)
  const thinkingFromDone = normalizeOllamaAssistantTextField(lastDoneMessage.thinking)

  const mergedContent =
    accumulated.content.value.length > 0 ? accumulated.content.value : contentFromDone
  const mergedThinking =
    accumulated.thinking.value.length > 0 ? accumulated.thinking.value : thinkingFromDone

  const mergedMessage: Record<string, unknown> = {
    ...lastDoneMessage,
    content: mergedContent,
  }

  const finalMessage = parseToolChatMessage(mergedMessage)
  const hasToolCalls = finalMessage.tool_calls && finalMessage.tool_calls.length > 0

  if (hasToolCalls) {
    yield { type: 'assistant_message', message: finalMessage }
    return
  }

  const displayContent = finalMessage.content

  const finalMessageForUi: ToolChatMessage = {
    ...finalMessage,
    content: displayContent,
  }

  const typingPieces = splitForTypingEffect(finalMessageForUi.content)
  for (let pieceIndex = 0; pieceIndex < typingPieces.length; pieceIndex += 1) {
    if (pieceIndex > 0) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0)
      })
    }
    yield { type: 'content_chunk', text: typingPieces[pieceIndex]! }
  }

  yield { type: 'assistant_message', message: finalMessageForUi }
}

export async function generateStructuredResponse<T>(
  request: StructuredResponseRequest<T>,
): Promise<T> {
  const {
    model,
    messages,
    schema,
    validate,
    maxAttempts = 2,
    think = false,
    options,
  } = request

  let lastError: unknown = null
  let attemptMessages = [...messages]

  for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex += 1) {
    let rawResponse = ''

    try {
      rawResponse = await collectChatResponse({
        model,
        messages: attemptMessages,
        stream: false,
        think,
        format: schema,
        options,
      })

      const parsed = parseStructuredResponse(rawResponse)
      return validate(parsed)
    } catch (error) {
      lastError = error
      logger.warn(
        { error, attempt: attemptIndex + 1, maxAttempts },
        '[StructuredResponse] Attempt failed',
      )

      if (attemptIndex === maxAttempts - 1) {
        break
      }

      attemptMessages = [
        ...messages,
        { role: 'assistant', content: rawResponse },
        {
          role: 'user',
          content: buildStructuredRepairPrompt(schema, rawResponse, error),
        },
      ]
    }
  }

  throw new Error(
    `Structured response failed after ${maxAttempts} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  )
}

export async function collectChatResponse(request: ChatRequest): Promise<string> {
  let response = ''
  for await (const chunk of chat(request)) {
    response += chunk
  }

  return response
}

export function parseJsonFromModelResponse(raw: string): Record<string, unknown> | null {
  const sanitized = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/g, '')
  const balanced = extractFirstBalancedJsonObject(sanitized)
  const toParse = balanced ?? sanitized
  try {
    const parsed: unknown = JSON.parse(toParse)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    return null
  }
  return null
}

function parseStructuredResponse(rawResponse: string): Record<string, unknown> {
  const sanitizedResponse = sanitizeStructuredJsonResponse(rawResponse)
  const parsed: unknown = JSON.parse(sanitizedResponse)

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Structured response must be a JSON object')
  }

  return parsed as Record<string, unknown>
}

function extractFirstBalancedJsonObject(value: string): string | null {
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

function sanitizeStructuredJsonResponse(rawResponse: string): string {
  let cleaned = rawResponse.trim()
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/g, '')

  const balanced = extractFirstBalancedJsonObject(cleaned)
  if (balanced !== null) {
    return balanced
  }

  const firstBraceIndex = cleaned.indexOf('{')
  const lastBraceIndex = cleaned.lastIndexOf('}')
  if (firstBraceIndex !== -1 && lastBraceIndex !== -1 && lastBraceIndex > firstBraceIndex) {
    cleaned = cleaned.slice(firstBraceIndex, lastBraceIndex + 1)
  }

  return cleaned
}

function buildStructuredRepairPrompt(
  schema: Record<string, unknown>,
  rawResponse: string,
  error: unknown,
): string {
  const errorMessage = error instanceof Error ? error.message : String(error)

  return [
    'Your previous response was invalid for the required JSON schema.',
    'Reply again with exactly one valid JSON object and no other text.',
    'Do not use markdown or code fences.',
    `Validation error: ${errorMessage}`,
    'Required schema:',
    JSON.stringify(schema, null, 2),
    'Previous invalid response:',
    rawResponse || '(empty response)',
  ].join('\n')
}
