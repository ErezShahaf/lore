import type { RecommendedModel, ModelVariant } from './types'

export const RECOMMENDED_MODELS: RecommendedModel[] = [

  {
    displayName: 'Qwen 3.5 4B',
    parametersBillions: 4,
    tier: 'medium',
    category: 'chat',
    description: 'Strong fallback when 9B does not fit',
    gpuRecommended: false,
    variants: [
      { tag: 'qwen3.5:4b', quantization: 'Q4_K_M', sizeOnDisk: '~3.4 GB', minRAMGB: 6 },
      { tag: 'qwen3.5:4b-q8_0', quantization: 'Q8', sizeOnDisk: '~5.3 GB', minRAMGB: 8 },
    ],
  },
  {
    displayName: 'Qwen 3.5 9B',
    parametersBillions: 9,
    tier: 'medium',
    category: 'chat',
    description: 'Recommended — best quality for RAG when your system can run it',
    gpuRecommended: true,
    variants: [
      { tag: 'qwen3.5:9b', quantization: 'Q4_K_M', sizeOnDisk: '~6.6 GB', minRAMGB: 8 },
      { tag: 'qwen3.5:9b-q8_0', quantization: 'Q8', sizeOnDisk: '~11 GB', minRAMGB: 16 },
    ],
  },
  // ── Embedding models ──────────────────────────────────────
  {
    displayName: 'Qwen 3 Embedding 0.6B',
    parametersBillions: 0.6,
    tier: 'medium',
    category: 'embedding',
    description: 'Best quality small-model option for multilingual and code retrieval',
    gpuRecommended: false,
    variants: [
      { tag: 'qwen3-embedding:0.6b', quantization: 'Default', sizeOnDisk: '~639 MB', minRAMGB: 6 },
    ],
  },
  {
    displayName: 'BGE-M3',
    parametersBillions: 0.567,
    tier: 'medium',
    category: 'embedding',
    description: 'Strong multilingual choice for longer documents and cross-language search',
    gpuRecommended: false,
    variants: [
      { tag: 'bge-m3', quantization: 'Default', sizeOnDisk: '~1.2 GB', minRAMGB: 8 },
    ],
  },
  {
    displayName: 'MXBAI Embed Large',
    parametersBillions: 0.335,
    tier: 'small',
    category: 'embedding',
    description: 'High-quality general-purpose retrieval model with broad community adoption',
    gpuRecommended: false,
    variants: [
      { tag: 'mxbai-embed-large', quantization: 'Default', sizeOnDisk: '~670 MB', minRAMGB: 6 },
    ],
  },
  {
    displayName: 'Nomic Embed Text',
    parametersBillions: 0.137,
    tier: 'small',
    category: 'embedding',
    description: 'Fast, high-quality embeddings — recommended default',
    gpuRecommended: false,
    variants: [
      { tag: 'nomic-embed-text', quantization: 'Default', sizeOnDisk: '~274 MB', minRAMGB: 4 },
    ],
  },
]

/**
 * Pick the fastest variant of a model that fits within the system's RAM.
 * Prefers Q4 (smaller/faster) over Q8 — quality gains from heavier
 * quantization don't matter when the LLM is only making decisions
 * over user-provided context.
 */
export function pickBestVariant(
  model: RecommendedModel,
  totalMemoryGB: number | null,
): ModelVariant {
  if (totalMemoryGB === null) return model.variants[0]

  for (const variant of model.variants) {
    if (variant.minRAMGB <= totalMemoryGB) {
      return variant
    }
  }

  return model.variants[0]
}

/**
 * Sort models so the best compatible model appears first.
 * Compatible models sorted largest-first (best quality); incompatible
 * ones after, smallest-first so near-misses show first.
 */
export function sortModelsForSystem(
  models: RecommendedModel[],
  totalMemoryGB: number | null,
): RecommendedModel[] {
  if (totalMemoryGB === null) return models

  return [...models].sort((a, b) => {
    const aFits = a.variants[0].minRAMGB <= totalMemoryGB
    const bFits = b.variants[0].minRAMGB <= totalMemoryGB

    if (aFits && !bFits) return -1
    if (!aFits && bFits) return 1
    return b.parametersBillions - a.parametersBillions
  })
}
