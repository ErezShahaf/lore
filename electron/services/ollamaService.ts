import { getSettings } from './settingsService'
import type { OllamaModel, ChatRequest, PullProgress, OllamaStatus } from '../../shared/types'

export const CHAT_NUM_CTX = 8192

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
          if (res.ok) console.log(`[Lore] Preloaded chat model: ${chatModel}`)
          else console.warn(`[Lore] Failed to preload chat model ${chatModel}: ${res.statusText}`)
        })
        .catch((err) => console.warn(`[Lore] Failed to preload chat model ${chatModel}:`, err)),
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
          if (res.ok) console.log(`[Lore] Preloaded embedding model: ${embedModel}`)
          else console.warn(`[Lore] Failed to preload embedding model ${embedModel}: ${res.statusText}`)
        })
        .catch((err) => console.warn(`[Lore] Failed to preload embedding model ${embedModel}:`, err)),
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

export async function generateStructuredResponse(
  model: string,
  prompt: string,
  schema: object,
  requestOptions?: { think?: boolean; options?: { num_ctx?: number } },
): Promise<object> {
  const res = await fetch(`${getHost()}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      format: schema,
      keep_alive: -1,
      ...requestOptions,
      options: { num_ctx: CHAT_NUM_CTX, ...requestOptions?.options },
    }),
  })

  if (!res.ok) throw new Error(`Structured response failed: ${res.statusText}`)

  const data = await res.json()
  return JSON.parse(data.message?.content ?? '{}')
}
