import type { RecommendedModel, OllamaModel } from './types'
import { RECOMMENDED_MODELS } from './models'

/**
 * Classify a model as 'chat' or 'embedding' based on known metadata and heuristics.
 * This ensures consistency across the UI and prevents newly installed embedders
 * from being miscategorized due to fragile name-based filtering.
 */
export function classifyModel(model: OllamaModel): 'chat' | 'embedding' {
  // First, check if this model exists in RECOMMENDED_MODELS
  const recommended = findRecommendedModel(model.name)
  if (recommended) {
    return recommended.category
  }

  // Fallback: use heuristics for externally installed models
  const nameNormalized = model.name.toLowerCase()

  // Embedding model keywords: bge, e5, gte, embedding, embed, minilm, snowflake, nomic, qwen3-embedding, mxbai
  const embeddingKeywords = [
    'bge',
    'e5',
    'gte',
    'embedding',
    'embed',
    'minilm',
    'snowflake',
    'nomic',
    'qwen3-embedding',
    'mxbai',
  ]

  if (embeddingKeywords.some(keyword => nameNormalized.includes(keyword))) {
    return 'embedding'
  }

  // Default to chat if no embedding indicators found
  return 'chat'
}

/**
 * Find a RecommendedModel that matches the given tag.
 * Handles both exact matches and prefix matches (e.g., 'qwen3.5:9b' matches 'qwen3.5:9b-q8_0').
 */
function findRecommendedModel(tag: string): RecommendedModel | null {
  for (const model of RECOMMENDED_MODELS) {
    for (const variant of model.variants) {
      if (tag === variant.tag || tag.startsWith(variant.tag + ':')) {
        return model
      }
    }
  }
  return null
}

/**
 * Filter models into chat and embedding groups using consistent classification.
 */
export function groupModelsByType(models: OllamaModel[]): {
  chat: OllamaModel[]
  embedding: OllamaModel[]
} {
  const chat: OllamaModel[] = []
  const embedding: OllamaModel[] = []

  for (const model of models) {
    if (classifyModel(model) === 'embedding') {
      embedding.push(model)
    } else {
      chat.push(model)
    }
  }

  return { chat, embedding }
}
