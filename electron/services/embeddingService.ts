import { getSettings } from './settingsService'
import { resolveOllamaKeepAlive } from './resolveOllamaKeepAlive'
import { isEvalRuntimeProfile } from './runtimeProfileService'

const EMBEDDING_DIMENSIONS: Record<string, number> = {
  'qwen3-embedding:0.6b': 1024,
  'bge-m3': 1024,
  'nomic-embed-text': 768,
  'mxbai-embed-large': 1024,
  'all-minilm': 384,
  'snowflake-arctic-embed': 1024,
}

const DEFAULT_EMBEDDING_MODEL_NAME = 'nomic-embed-text'
const DEFAULT_DIMENSION = 768

function getHost(): string {
  return getSettings().ollamaHost || 'http://127.0.0.1:11434'
}

function getModel(): string {
  return getSettings().embeddingModel || DEFAULT_EMBEDDING_MODEL_NAME
}

/**
 * Resolve the vector dimension for a given model name. An empty string
 * resolves to the default model so "no model selected yet" and "default"
 * always collapse to the same effective dimension — avoids the mismatch
 * where the table is built at 768 but later queries embed at 1024.
 */
export function resolveEmbeddingDimensionForModelName(modelName: string): number {
  const trimmed = typeof modelName === 'string' ? modelName.trim() : ''
  const effectiveModelName = trimmed.length > 0 ? trimmed : DEFAULT_EMBEDDING_MODEL_NAME
  return EMBEDDING_DIMENSIONS[effectiveModelName] ?? DEFAULT_DIMENSION
}

export function getEmbeddingDimension(): number {
  return resolveEmbeddingDimensionForModelName(getSettings().embeddingModel)
}

export async function embedText(text: string): Promise<Float32Array> {
  const res = await fetch(`${getHost()}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: getModel(),
      input: text,
      keep_alive: resolveOllamaKeepAlive(getSettings()),
    }),
    ...(isEvalRuntimeProfile() ? {} : { signal: AbortSignal.timeout(30_000) }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText)
    throw new Error(`Embedding failed (${res.status}): ${body}`)
  }

  const data = await res.json()
  const embeddings = data.embeddings
  if (!embeddings || !embeddings[0]) {
    throw new Error('No embedding returned from Ollama')
  }

  return new Float32Array(embeddings[0])
}

export async function embedTexts(texts: string[]): Promise<Float32Array[]> {
  const res = await fetch(`${getHost()}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: getModel(),
      input: texts,
      keep_alive: resolveOllamaKeepAlive(getSettings()),
    }),
    ...(isEvalRuntimeProfile() ? {} : { signal: AbortSignal.timeout(60_000) }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText)
    throw new Error(`Batch embedding failed (${res.status}): ${body}`)
  }

  const data = await res.json()
  const embeddings = data.embeddings
  if (!embeddings || !Array.isArray(embeddings)) {
    throw new Error('No embeddings returned from Ollama')
  }

  return embeddings.map((e: number[]) => new Float32Array(e))
}
