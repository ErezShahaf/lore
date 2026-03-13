import type { RecommendedModel, ModelVariant } from './types'

export const RECOMMENDED_MODELS: RecommendedModel[] = [
  // ── Chat models ───────────────────────────────────────────
  {
    displayName: 'Llama 3.2',
    parametersBillions: 3,
    tier: 'small',
    category: 'chat',
    description: 'Fast & lightweight — runs on almost anything',
    gpuRecommended: false,
    variants: [
      { tag: 'llama3.2:3b', quantization: 'Q4_K_M', sizeOnDisk: '~2 GB', minRAMGB: 4 },
      { tag: 'llama3.2:3b-q8_0', quantization: 'Q8', sizeOnDisk: '~3.4 GB', minRAMGB: 6 },
    ],
  },
  {
    displayName: 'Phi-4 Mini',
    parametersBillions: 3.8,
    tier: 'small',
    category: 'chat',
    description: 'Best reasoning at small size — recommended default',
    gpuRecommended: false,
    variants: [
      { tag: 'phi4-mini', quantization: 'Q4_K_M', sizeOnDisk: '~2.5 GB', minRAMGB: 6 },
      { tag: 'phi4-mini:q8_0', quantization: 'Q8', sizeOnDisk: '~4.5 GB', minRAMGB: 8 },
    ],
  },
  {
    displayName: 'Gemma 3',
    parametersBillions: 4,
    tier: 'small',
    category: 'chat',
    description: 'Excellent instruction following, power-efficient',
    gpuRecommended: false,
    variants: [
      { tag: 'gemma3:4b', quantization: 'Q4_K_M', sizeOnDisk: '~3 GB', minRAMGB: 6 },
      { tag: 'gemma3:4b-q8_0', quantization: 'Q8', sizeOnDisk: '~5 GB', minRAMGB: 8 },
    ],
  },
  {
    displayName: 'Mistral 7B',
    parametersBillions: 7,
    tier: 'medium',
    category: 'chat',
    description: 'Higher quality — needs more RAM and benefits from GPU',
    gpuRecommended: true,
    variants: [
      { tag: 'mistral:7b', quantization: 'Q4_K_M', sizeOnDisk: '~4.5 GB', minRAMGB: 8 },
      { tag: 'mistral:7b-q8_0', quantization: 'Q8', sizeOnDisk: '~8 GB', minRAMGB: 12 },
    ],
  },
  {
    displayName: 'Phi-4',
    parametersBillions: 14,
    tier: 'large',
    category: 'chat',
    description: 'Near cloud-quality reasoning — needs 16GB+ RAM',
    gpuRecommended: true,
    variants: [
      { tag: 'phi4:14b', quantization: 'Q4_K_M', sizeOnDisk: '~10 GB', minRAMGB: 16 },
      { tag: 'phi4:14b-q8_0', quantization: 'Q8', sizeOnDisk: '~16 GB', minRAMGB: 24 },
    ],
  },
  // ── Embedding models ──────────────────────────────────────
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
  {
    displayName: 'All-MiniLM',
    parametersBillions: 0.033,
    tier: 'small',
    category: 'embedding',
    description: 'Ultra-lightweight embeddings for constrained systems',
    gpuRecommended: false,
    variants: [
      { tag: 'all-minilm', quantization: 'Default', sizeOnDisk: '~67 MB', minRAMGB: 4 },
    ],
  },
]

/**
 * Pick the highest-quality variant of a model that fits within the system's RAM.
 * Falls back to the smallest variant if nothing fits.
 */
export function pickBestVariant(
  model: RecommendedModel,
  totalMemoryGB: number | null,
): ModelVariant {
  if (totalMemoryGB === null) return model.variants[0]

  for (let i = model.variants.length - 1; i >= 0; i--) {
    if (model.variants[i].minRAMGB <= totalMemoryGB) {
      return model.variants[i]
    }
  }

  return model.variants[0]
}

/**
 * Sort models so the best for the user's system appears first.
 * Compatible models sorted largest-first, then incompatible ones after.
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
    if (aFits && bFits) return b.parametersBillions - a.parametersBillions
    return a.parametersBillions - b.parametersBillions
  })
}
