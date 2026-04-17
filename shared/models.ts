import type { RecommendedModel, ModelVariant, SystemInfo } from './types'

export const RECOMMENDED_MODELS: RecommendedModel[] = [

  // ── Chat models (priority = quality ranking in Lore) ────────

  {
    displayName: 'Gemma 4 26B',
    parametersBillions: 26,
    tier: 'large',
    category: 'chat',
    description: 'MoE architecture — only 4B parameters active per token, full 26B quality',
    gpuRecommended: true,
    recommendationPriority: 1,
    variants: [
      { tag: 'gemma4:26b', quantization: 'Q4_K_M', sizeOnDisk: '~18 GB', minRAMGB: 20, minVramMB: 20480 },
    ],
  },
  {
    displayName: 'Qwen 3.5 9B',
    parametersBillions: 9,
    tier: 'medium',
    category: 'chat',
    description: 'Strong all-round model for RAG — runs well on most machines',
    gpuRecommended: true,
    recommendationPriority: 2,
    variants: [
      { tag: 'qwen3.5:9b', quantization: 'Q4_K_M', sizeOnDisk: '~6.6 GB', minRAMGB: 8, minVramMB: null },
      { tag: 'qwen3.5:9b-q8_0', quantization: 'Q8', sizeOnDisk: '~11 GB', minRAMGB: 16, minVramMB: null },
    ],
  },
  {
    displayName: 'Gemma 4 E4B',
    parametersBillions: 8,
    tier: 'medium',
    category: 'chat',
    description: 'MoE with effective 4B active parameters — quality-focused alternative',
    gpuRecommended: false,
    recommendationPriority: 3,
    variants: [
      { tag: 'gemma4:e4b', quantization: 'Q4_K_M', sizeOnDisk: '~9.6 GB', minRAMGB: 12, minVramMB: null },
    ],
  },
  {
    displayName: 'Gemma 4 E2B',
    parametersBillions: 4,
    tier: 'small',
    category: 'chat',
    description: 'Lightweight model for constrained hardware',
    gpuRecommended: false,
    recommendationPriority: 4,
    variants: [
      { tag: 'gemma4:e2b', quantization: 'Q4_K_M', sizeOnDisk: '~7.2 GB', minRAMGB: 8, minVramMB: null },
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
    recommendationPriority: 0,
    variants: [
      { tag: 'qwen3-embedding:0.6b', quantization: 'Default', sizeOnDisk: '~639 MB', minRAMGB: 6, minVramMB: null },
    ],
  },
  {
    displayName: 'BGE-M3',
    parametersBillions: 0.567,
    tier: 'medium',
    category: 'embedding',
    description: 'Strong multilingual choice for longer documents and cross-language search',
    gpuRecommended: false,
    recommendationPriority: 0,
    variants: [
      { tag: 'bge-m3', quantization: 'Default', sizeOnDisk: '~1.2 GB', minRAMGB: 8, minVramMB: null },
    ],
  },
  {
    displayName: 'MXBAI Embed Large',
    parametersBillions: 0.335,
    tier: 'small',
    category: 'embedding',
    description: 'High-quality general-purpose retrieval model with broad community adoption',
    gpuRecommended: false,
    recommendationPriority: 0,
    variants: [
      { tag: 'mxbai-embed-large', quantization: 'Default', sizeOnDisk: '~670 MB', minRAMGB: 6, minVramMB: null },
    ],
  },
  {
    displayName: 'Nomic Embed Text',
    parametersBillions: 0.137,
    tier: 'small',
    category: 'embedding',
    description: 'Fast, high-quality embeddings — recommended default',
    gpuRecommended: false,
    recommendationPriority: 0,
    variants: [
      { tag: 'nomic-embed-text', quantization: 'Default', sizeOnDisk: '~274 MB', minRAMGB: 4, minVramMB: null },
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
 * Determine whether a model can run efficiently on the current hardware.
 *
 * - RAM must meet the minimum for the first (smallest) variant.
 * - If the model declares a VRAM requirement and VRAM was detected,
 *   effective VRAM must meet it.
 * - If VRAM is null (detection failed), the VRAM check is skipped
 *   so no model is penalised or promoted — pure priority order.
 */
export function canRunEfficiently(
  model: RecommendedModel,
  effectiveVramMB: number | null,
  totalMemoryGB: number,
): boolean {
  const baseVariant = model.variants[0]
  if (baseVariant.minRAMGB > totalMemoryGB) return false

  if (baseVariant.minVramMB !== null && effectiveVramMB !== null) {
    if (effectiveVramMB < baseVariant.minVramMB) return false
  }

  return true
}

/**
 * Whether VRAM was detected and we can make confident hardware judgements.
 * When false, no "Best for your system" or "Not supported" tags should appear.
 */
export function isVramKnown(systemInfo: SystemInfo | null): boolean {
  return systemInfo?.gpu?.vramMB !== null && systemInfo?.gpu?.vramMB !== undefined
}

/**
 * Sort models so the best compatible model appears first.
 *
 * When VRAM is known: supported models first (by priority), then unsupported (by priority).
 * When VRAM is unknown: pure priority order — no model is promoted or demoted.
 */
export function sortModelsForSystem(
  models: RecommendedModel[],
  systemInfo: SystemInfo | null,
): RecommendedModel[] {
  if (!systemInfo) return [...models].sort((a, b) => a.recommendationPriority - b.recommendationPriority)

  const effectiveVramMB = systemInfo.gpu?.vramMB ?? null
  const vramDetected = effectiveVramMB !== null

  return [...models].sort((a, b) => {
    if (vramDetected) {
      const aFits = canRunEfficiently(a, effectiveVramMB, systemInfo.totalMemoryGB)
      const bFits = canRunEfficiently(b, effectiveVramMB, systemInfo.totalMemoryGB)

      if (aFits && !bFits) return -1
      if (!aFits && bFits) return 1
    }

    return a.recommendationPriority - b.recommendationPriority
  })
}
