# Phase 9 — Model Management, Downloads & System Detection

## Goal

Overhaul the Model Settings tab into a polished, intelligent model management experience. The user should see a clear dropdown of installed models (with the active model visually highlighted), download recommended models with real progress feedback, and receive hardware-aware guidance on which models their system can actually run. No dead buttons, no mystery inputs — everything functional and obvious.

## Prerequisites

- Phase 1–8 complete
- Ollama installed and connectable

## Research Summary

### Best Local LLMs for This Project

Lore is a personal knowledge management app: it classifies user input, stores thoughts, retrieves context via RAG, and generates conversational responses. The ideal chat model needs strong instruction following, good reasoning, and fast inference on consumer hardware. The ideal embedding model needs high-quality semantic similarity at low cost.

#### Chat Models (ranked by quality-per-resource)

| Model | Parameters | RAM (Q4) | Strengths | Best For |
|---|---|---|---|---|
| `llama3.2:3b` | 3B | ~2 GB | Fast, solid quality, 128K context | Low-end systems, quick responses |
| `phi4-mini` | 3.8B | ~3 GB | Best reasoning at this size, beats Llama 3.2 on math/logic, 128K context | Systems with 8GB RAM, best small model |
| `gemma3:4b` | 4B | ~3 GB | Excellent instruction following, 128K context, power-efficient | Good alternative to phi4-mini |
| `mistral:7b` | 7B | ~4.5 GB | Higher quality generation, mature ecosystem | Systems with 8–16GB RAM |
| `qwen2.5:7b` | 7B | ~5 GB | Strong multilingual, 32K context, excellent at structured output | Multilingual users, JSON tasks |
| `phi4:14b` | 14B | ~10 GB | Near-GPT-4o quality on reasoning, best local model under 16B | Systems with 16GB+ RAM |

#### Embedding Models

| Model | Dimensions | Size | MTEB Score | Context | Notes |
|---|---|---|---|---|---|
| `nomic-embed-text` | 768 | 274 MB | 95.2% | 8192 tokens | Best balance, current default |
| `snowflake-arctic-embed` | 768 | 335 MB | 94.8% | 512 tokens | Excellent for technical content |
| `all-minilm` | 384 | 67 MB | 92.3% | 512 tokens | Ultralight, 10x faster |
| `mxbai-embed-large` | 1024 | 670 MB | 97.1% | 512 tokens | Highest accuracy, needs more RAM |

**Recommendation**: Keep `nomic-embed-text` as the default embedding model. It has the best balance of quality, context length, and size. `all-minilm` is a viable fallback for very constrained systems.

### Hardware Detection in Electron

**Available APIs (no extra dependencies needed):**

| Info | API | Notes |
|---|---|---|
| Total RAM | `os.totalmem()` | Returns bytes, works on all platforms |
| Free RAM | `os.freemem()` | Current available memory |
| CPU model | `os.cpus()[0].model` | CPU name, core count via `os.cpus().length` |
| OS platform | `process.platform` | `'win32'`, `'darwin'`, `'linux'` |
| OS version | `os.release()` | Kernel version string |
| GPU info | `app.getGPUInfo('complete')` | Electron-only, returns vendor, device, driver info |

**GPU info from `app.getGPUInfo('complete')` returns:**
- `gpuDevice[]` — array with `{ vendorId, deviceId, active, vendorString, deviceString }`
- `auxAttributes` — driver info: `glRenderer`, `glVendor`, `glVersion`, `driverVersion`

**Vendor ID mapping:**
- `0x10DE` → NVIDIA (CUDA support via Ollama)
- `0x1002` → AMD (ROCm on Linux, DirectML on Windows)
- `0x8086` → Intel (CPU-only for LLMs in practice)
- `0x106B` → Apple (Metal — Apple Silicon, automatic in Ollama on macOS)

**Ollama GPU acceleration:**
- NVIDIA: Automatic if CUDA drivers installed. Works on Windows and Linux.
- AMD: ROCm support on Linux only. Windows AMD GPUs run CPU-only through Ollama.
- Apple Silicon: Metal acceleration is automatic on macOS.
- Intel: No GPU acceleration for LLMs via Ollama. CPU-only.
- CPU-only: Ollama always works on CPU. Smaller models (3-4B) run fine, 7B is usable, 14B+ is slow.

### Model Size vs System RAM Guidelines

| System RAM | Max Recommended Model | Quantization | Notes |
|---|---|---|---|
| 4 GB | 3B (llama3.2:3b) | Q4_K_M | Tight — OS needs ~2GB, leaving ~2GB for model |
| 8 GB | 7B (mistral:7b) | Q4_K_M | Comfortable for 3-4B, snug for 7B |
| 16 GB | 14B (phi4:14b) | Q4_K_M | Can run any recommended model comfortably |
| 32 GB+ | 14B+ | Q4_K_M–Q8 | Can use higher quantization for better quality |

**VRAM (if dedicated GPU):**
- 4 GB VRAM → 3B Q4 fully on GPU
- 6–8 GB VRAM → 7B Q4 fully on GPU
- 12 GB VRAM → 14B Q4 fully on GPU
- Less VRAM than model needs → Ollama auto-splits between GPU and CPU (slower)

## Steps

### 9.1 System info service

Create `electron/services/systemInfoService.ts` to detect hardware capabilities:

```typescript
import os from 'node:os'
import { app } from 'electron'

export interface SystemInfo {
  platform: 'win32' | 'darwin' | 'linux'
  osVersion: string
  arch: string
  totalMemoryGB: number
  freeMemoryGB: number
  cpuModel: string
  cpuCores: number
  gpu: GpuInfo | null
}

export interface GpuInfo {
  vendor: 'nvidia' | 'amd' | 'intel' | 'apple' | 'unknown'
  vendorString: string
  deviceString: string
  vramMB: number | null       // Not always available via Electron API
  cudaSupported: boolean
  metalSupported: boolean
  rocmSupported: boolean
}

export type ModelTier = 'small' | 'medium' | 'large'

export interface HardwareProfile {
  maxModelTier: ModelTier
  maxParametersBillions: number
  gpuAcceleration: boolean
  gpuAccelerationType: 'cuda' | 'metal' | 'rocm' | 'none'
  warnings: string[]
}
```

**Key functions:**

- `getSystemInfo(): Promise<SystemInfo>` — collects all hardware info
  - Use `os.totalmem()`, `os.cpus()`, `process.platform`, `os.release()`, `os.arch()`
  - Call `app.getGPUInfo('complete')` for GPU details
  - Map `vendorId` to vendor enum (`0x10DE` → nvidia, etc.)
  - On macOS with Apple Silicon: detect via `os.cpus()[0].model` containing "Apple" and `os.arch() === 'arm64'`

- `getHardwareProfile(systemInfo: SystemInfo): HardwareProfile` — determines what the system can run
  - Calculate `maxParametersBillions` from available RAM: `Math.floor((totalMemoryGB - 2.5) / 0.55)` (reserve ~2.5GB for OS, ~0.55GB per billion params at Q4)
  - Determine `maxModelTier`: ≤4B → 'small', ≤8B → 'medium', >8B → 'large'
  - Set `gpuAcceleration` and type based on GPU vendor + platform combo
  - Populate `warnings[]` for edge cases:
    - AMD GPU on Windows → "AMD GPUs have limited Ollama support on Windows. Models will run on CPU."
    - Intel GPU → "Intel GPUs are not supported for LLM acceleration. Models will run on CPU."
    - Low RAM (<6GB) → "Limited RAM detected. Only small models (3B) are recommended."
    - No GPU detected → "No dedicated GPU detected. Models will run on CPU (slower for large models)."

**Caching:** Cache the result since hardware doesn't change during a session. Compute once on app startup.

### 9.2 Updated recommended models list

Replace the static `SUGGESTED_MODELS` array with a richer definition that includes hardware requirements:

```typescript
export interface RecommendedModel {
  name: string
  displayName: string
  parametersBillions: number
  sizeOnDisk: string          // Human-readable, e.g. "~2 GB"
  minRAMGB: number            // Minimum total system RAM needed
  tier: 'small' | 'medium' | 'large'
  category: 'chat' | 'embedding'
  description: string
  gpuRecommended: boolean     // True if 7B+
}

const RECOMMENDED_MODELS: RecommendedModel[] = [
  // ── Chat models ───────────────────────────────────────────
  {
    name: 'llama3.2:3b',
    displayName: 'Llama 3.2',
    parametersBillions: 3,
    sizeOnDisk: '~2 GB',
    minRAMGB: 4,
    tier: 'small',
    category: 'chat',
    description: 'Fast & lightweight — runs on almost anything',
    gpuRecommended: false,
  },
  {
    name: 'phi4-mini',
    displayName: 'Phi-4 Mini',
    parametersBillions: 3.8,
    sizeOnDisk: '~2.5 GB',
    minRAMGB: 6,
    tier: 'small',
    category: 'chat',
    description: 'Best reasoning at small size — recommended default',
    gpuRecommended: false,
  },
  {
    name: 'gemma3:4b',
    displayName: 'Gemma 3',
    parametersBillions: 4,
    sizeOnDisk: '~3 GB',
    minRAMGB: 6,
    tier: 'small',
    category: 'chat',
    description: 'Excellent instruction following, power-efficient',
    gpuRecommended: false,
  },
  {
    name: 'mistral:7b',
    displayName: 'Mistral 7B',
    parametersBillions: 7,
    sizeOnDisk: '~4.5 GB',
    minRAMGB: 8,
    tier: 'medium',
    category: 'chat',
    description: 'Higher quality — needs more RAM and benefits from GPU',
    gpuRecommended: true,
  },
  {
    name: 'phi4:14b',
    displayName: 'Phi-4',
    parametersBillions: 14,
    sizeOnDisk: '~10 GB',
    minRAMGB: 16,
    tier: 'large',
    category: 'chat',
    description: 'Near cloud-quality reasoning — needs 16GB+ RAM',
    gpuRecommended: true,
  },
  // ── Embedding models ──────────────────────────────────────
  {
    name: 'nomic-embed-text',
    displayName: 'Nomic Embed Text',
    parametersBillions: 0.137,
    sizeOnDisk: '~274 MB',
    minRAMGB: 4,
    tier: 'small',
    category: 'embedding',
    description: 'Fast, high-quality embeddings — recommended default',
    gpuRecommended: false,
  },
  {
    name: 'all-minilm',
    displayName: 'All-MiniLM',
    parametersBillions: 0.033,
    sizeOnDisk: '~67 MB',
    minRAMGB: 4,
    tier: 'small',
    category: 'embedding',
    description: 'Ultra-lightweight embeddings for constrained systems',
    gpuRecommended: false,
  },
]
```

This data should live in a shared location (e.g. `shared/models.ts`) so both the main process and renderer can access it.

### 9.3 IPC: expose system info to renderer

Add new IPC channel and preload method:

**`electron/ipc/handlers.ts`** — add handler:
```typescript
ipcMain.handle('system:info', async () => {
  return getSystemInfo()
})

ipcMain.handle('system:hardware-profile', async () => {
  const info = await getSystemInfo()
  return getHardwareProfile(info)
})
```

**`electron/preload.ts`** — add to loreAPI:
```typescript
getSystemInfo: (): Promise<SystemInfo> =>
  ipcRenderer.invoke('system:info'),

getHardwareProfile: (): Promise<HardwareProfile> =>
  ipcRenderer.invoke('system:hardware-profile'),
```

**`src/types/electron.d.ts`** — add types to Window.loreAPI.

**`shared/types.ts`** — add `SystemInfo`, `GpuInfo`, `HardwareProfile`, `ModelTier` types (from 9.1).

### 9.4 Redesigned ModelSettings component

Restructure `src/components/settings/ModelSettings.tsx` with the following sections in order:

#### Section A: Ollama connection status (keep as-is)
The existing green/red dot with "Connected to Ollama" / "Ollama not connected" is good. Keep the install link with the red styling for the not-connected state.

#### Section B: Model selection (redesigned)

**When installed models exist:**
- Render a styled `<select>` dropdown (or custom dropdown component) showing all installed chat models
- The dropdown's default value is `settings.selectedModel`
- The currently active/saved model gets a visual distinction — use a highlighted ring or accent-colored border on the dropdown when the value matches the saved setting
- If the user changes the dropdown to a different model, show a "Save" button that calls `onUpdate({ selectedModel: newValue })`
- After saving, briefly flash a success indicator (green checkmark or "Saved!" text)
- Same pattern for the embedding model dropdown below

**When NO models are installed:**
- Don't show a dropdown at all
- Show a message: "No models installed. Download a model below to get started."
- Keep this clean — no empty dropdowns, no text inputs that do nothing

**Implementation detail — active model highlighting:**
```tsx
<select
  value={localSelectedModel}
  onChange={e => setLocalSelectedModel(e.target.value)}
  className={cn(
    'w-full max-w-xs rounded-md border px-3 py-2 text-sm',
    localSelectedModel === settings.selectedModel
      ? 'border-emerald-500/50 bg-emerald-500/10 text-foreground'
      : 'border-primary bg-primary/10 text-foreground'
  )}
>
```

The idea: when the dropdown value matches the saved setting, it shows emerald/green (meaning "this is active"). When the user picks a different value, it changes to the primary/blue color (meaning "unsaved change"). A "Save" button appears only when the value differs from the saved setting.

#### Section C: Installed models list (improved)

Keep the existing list of installed models with delete buttons. Add the model size display. No major changes needed here, it works well.

#### Section D: Download models (redesigned)

**Custom model input + download:**
Keep the existing input field for pulling arbitrary model names. This is useful for advanced users who know what model they want. The download button and progress bar already work via `handlePull`.

**Recommended models grid:**
Replace the current suggested models list with a hardware-aware grid:

For each recommended model:
1. Fetch `HardwareProfile` from the system info service on component mount
2. Compare each model's `minRAMGB` against the profile's capabilities
3. Render one of three states:

**State: Compatible & Not Installed**
- Show the model card with name, size, description
- Show a functional download button (existing red/primary style)
- On click → call `handlePull(model.name)` → show progress bar inline on that card
- Progress bar sits below the model card description
- Button is disabled while any pull is in progress (one download at a time)

**State: Compatible & Installed**
- Show the model card with name, size, description
- Replace the download button with a green checkmark icon (`Check` or `CircleCheck` from lucide-react)
- Show "Installed" in emerald text next to the icon

**State: Incompatible (system can't run it)**
- Show the model card with name, size, description — but slightly dimmed (lower opacity)
- Instead of a download button, show a warning icon and tooltip/text explaining why:
  - "Requires at least {minRAMGB}GB RAM (you have {actualRAM}GB)"
  - "Requires GPU acceleration (no compatible GPU detected)"
- The download button is either hidden or disabled with the tooltip

**Separate chat and embedding sections:**
Split the recommended models into two sub-sections:
- "Chat Models" — shows chat model recommendations
- "Embedding Models" — shows embedding model recommendations

Each section only shows models matching its category.

#### Section E: Ollama host (keep as-is)
The host input at the bottom is fine.

### 9.5 Per-model download progress tracking

Currently, `pulling` is a single boolean so only one model can download at a time (which is correct — Ollama processes pulls sequentially). But the progress should be visually tied to the specific model being downloaded.

Add state to track which model is currently being pulled:

```typescript
const [pullingModel, setPullingModel] = useState<string | null>(null)
const [pullProgress, setPullProgress] = useState<PullProgress | null>(null)
```

When rendering the recommended models list, show the progress bar only on the card whose `name === pullingModel`.

When the pull completes (success or error), clear `pullingModel` and refresh the model list.

### 9.6 System info display

Add a small collapsible "System Info" section at the bottom of the Model tab (above or below the Ollama host input). This helps the user understand why certain models are available/unavailable:

```
▸ System Info
  OS: Windows 11 (10.0.26200) x64
  CPU: 13th Gen Intel Core i7-13700K (24 cores)
  RAM: 32 GB total (24.3 GB available)
  GPU: NVIDIA GeForce RTX 4070 (CUDA)
  Max recommended model: 14B parameters
```

This is purely informational. Use a `<details>` element or a toggleable section. Fetch `SystemInfo` once on mount and cache it.

### 9.7 Handle edge cases

**Ollama not connected:**
- Model selection dropdowns: disabled with "Connect to Ollama first"
- Download buttons: disabled
- Installed models: show "Connect to Ollama to see installed models"
- System info section: still visible (it's local, doesn't need Ollama)

**Download fails mid-way:**
- Show error text on the specific model card
- Reset the download button so the user can retry
- Don't leave a stuck progress bar

**Model deleted while it's the active selection:**
- Already handled: the existing code clears `selectedModel` / `embeddingModel` when a model is deleted

**Model finishes downloading:**
- Auto-refresh the model list
- If no chat model was selected and the downloaded model is a chat model, auto-select it
- If no embedding model was selected and the downloaded model is an embedding model, auto-select it
- Show the green checkmark on the recommended model card

**Very low RAM system (<4GB):**
- Show a warning banner at the top of the Model tab: "Your system has limited RAM ({totalGB}GB). Small models may run slowly. Consider closing other applications while using Lore."
- Still allow downloading small models — don't completely block, just warn

### 9.8 Update shared types

Add to `shared/types.ts`:

```typescript
export interface SystemInfo {
  platform: 'win32' | 'darwin' | 'linux'
  osVersion: string
  arch: string
  totalMemoryGB: number
  freeMemoryGB: number
  cpuModel: string
  cpuCores: number
  gpu: GpuInfo | null
}

export interface GpuInfo {
  vendor: 'nvidia' | 'amd' | 'intel' | 'apple' | 'unknown'
  vendorString: string
  deviceString: string
  vramMB: number | null
  cudaSupported: boolean
  metalSupported: boolean
  rocmSupported: boolean
}

export type ModelTier = 'small' | 'medium' | 'large'

export interface HardwareProfile {
  maxModelTier: ModelTier
  maxParametersBillions: number
  gpuAcceleration: boolean
  gpuAccelerationType: 'cuda' | 'metal' | 'rocm' | 'none'
  warnings: string[]
}

export interface RecommendedModel {
  name: string
  displayName: string
  parametersBillions: number
  sizeOnDisk: string
  minRAMGB: number
  tier: ModelTier
  category: 'chat' | 'embedding'
  description: string
  gpuRecommended: boolean
}
```

## Verification

1. Open Settings → Model tab with Ollama running and models installed → see dropdown with active model highlighted green
2. Change model in dropdown → "Save" button appears → click Save → model updates, dropdown goes back to green
3. Open Settings with no models installed → no dropdown shown, just "No models installed" message
4. Click download on a recommended model → progress bar appears on that model's card → completes → green checkmark replaces download button
5. Model that requires more RAM than system has → shown dimmed with explanation, download button disabled
6. System Info section shows correct OS, CPU, RAM, GPU information
7. Download a model, then check model selection dropdown → newly downloaded model appears
8. Delete an installed model that was the active selection → dropdown clears, user prompted to select another
9. On a system with no dedicated GPU → warning shown, GPU-recommended models flagged appropriately
10. Download fails (e.g., typo in custom model name) → error shown on card, can retry
11. AMD GPU on Windows → warning message about CPU-only operation

## Files Created / Modified

```
electron/services/systemInfoService.ts          (new — hardware detection)
shared/models.ts                                (new — recommended models data)
shared/types.ts                                 (updated — SystemInfo, GpuInfo, HardwareProfile, RecommendedModel)
electron/ipc/handlers.ts                        (updated — system:info, system:hardware-profile handlers)
electron/preload.ts                             (updated — getSystemInfo, getHardwareProfile)
src/types/electron.d.ts                         (updated — new API types)
src/components/settings/ModelSettings.tsx        (rewritten — new model management UI)
```
