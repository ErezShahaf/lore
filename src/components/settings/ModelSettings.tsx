import { useState, useEffect, useCallback } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Download,
  Trash2,
  ExternalLink,
  Check,
  CircleCheck,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Cpu,
  Monitor,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { RECOMMENDED_MODELS } from '../../../shared/models'
import type {
  AppSettings,
  OllamaModel,
  OllamaStatus,
  PullProgress,
  SystemInfo,
  HardwareProfile,
  RecommendedModel,
} from '../../../shared/types'

interface ModelSettingsProps {
  settings: AppSettings
  onUpdate: (partial: Partial<AppSettings>) => void
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function platformDisplayName(platform: string, osVersion: string): string {
  if (platform === 'win32') {
    const build = parseInt(osVersion.split('.').pop() ?? '0', 10)
    return `Windows ${build >= 22000 ? '11' : '10'} (${osVersion})`
  }
  if (platform === 'darwin') return `macOS (${osVersion})`
  return `Linux (${osVersion})`
}

function gpuDisplayString(gpu: SystemInfo['gpu'], profile: HardwareProfile): string {
  if (!gpu) return 'None detected'
  const accel = profile.gpuAcceleration
    ? ` (${profile.gpuAccelerationType.toUpperCase()})`
    : ' (CPU only)'
  return `${gpu.deviceString}${accel}`
}

export function ModelSettings({ settings, onUpdate }: ModelSettingsProps) {
  const [status, setStatus] = useState<OllamaStatus>({ connected: false })
  const [models, setModels] = useState<OllamaModel[]>([])
  const [pullName, setPullName] = useState('')
  const [pullingModel, setPullingModel] = useState<string | null>(null)
  const [pullProgress, setPullProgress] = useState<PullProgress | null>(null)
  const [pullError, setPullError] = useState<string | null>(null)
  const [deleteLoading, setDeleteLoading] = useState<string | null>(null)
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null)
  const [hardwareProfile, setHardwareProfile] = useState<HardwareProfile | null>(null)
  const [systemInfoOpen, setSystemInfoOpen] = useState(false)

  const [localChatModel, setLocalChatModel] = useState(settings.selectedModel)
  const [localEmbeddingModel, setLocalEmbeddingModel] = useState(settings.embeddingModel)
  const [chatSaved, setChatSaved] = useState(false)
  const [embeddingSaved, setEmbeddingSaved] = useState(false)

  useEffect(() => { setLocalChatModel(settings.selectedModel) }, [settings.selectedModel])
  useEffect(() => { setLocalEmbeddingModel(settings.embeddingModel) }, [settings.embeddingModel])

  const refreshStatus = useCallback(async () => {
    const s = await window.loreAPI.getOllamaStatus()
    setStatus(s)
  }, [])

  const refreshModels = useCallback(async () => {
    const m = await window.loreAPI.listModels()
    setModels(m)
  }, [])

  useEffect(() => {
    refreshStatus()
    refreshModels()

    window.loreAPI.getSystemInfo().then(setSystemInfo)
    window.loreAPI.getHardwareProfile().then(setHardwareProfile)

    const cleanupStatus = window.loreAPI.onOllamaStatusChange((s) => {
      setStatus(s)
      refreshModels()
    })

    return cleanupStatus
  }, [refreshStatus, refreshModels])

  useEffect(() => {
    if (!pullingModel) return
    const cleanup = window.loreAPI.onPullProgress((progress) => {
      setPullProgress(progress)
    })
    return cleanup
  }, [pullingModel])

  const handlePull = async (name?: string) => {
    const modelName = name ?? pullName.trim()
    if (!modelName || pullingModel) return

    setPullingModel(modelName)
    setPullError(null)
    setPullProgress({ status: 'Starting download...' })

    const result = await window.loreAPI.pullModel(modelName)

    if (!result.success) {
      setPullError(result.error ?? 'Failed to pull model')
    } else {
      setPullName('')
      await refreshModels()

      const rec = RECOMMENDED_MODELS.find(m => m.name === modelName)
      if (rec?.category === 'chat' && !settings.selectedModel) {
        onUpdate({ selectedModel: modelName })
      }
      if (rec?.category === 'embedding' && !settings.embeddingModel) {
        onUpdate({ embeddingModel: modelName })
      }
    }

    setPullingModel(null)
    setPullProgress(null)
  }

  const handleDelete = async (name: string) => {
    setDeleteLoading(name)
    const result = await window.loreAPI.deleteModel(name)
    if (result.success) {
      await refreshModels()
      if (settings.selectedModel === name) onUpdate({ selectedModel: '' })
      if (settings.embeddingModel === name) onUpdate({ embeddingModel: '' })
    }
    setDeleteLoading(null)
  }

  const saveChatModel = () => {
    onUpdate({ selectedModel: localChatModel })
    setChatSaved(true)
    setTimeout(() => setChatSaved(false), 1500)
  }

  const saveEmbeddingModel = () => {
    onUpdate({ embeddingModel: localEmbeddingModel })
    setEmbeddingSaved(true)
    setTimeout(() => setEmbeddingSaved(false), 1500)
  }

  const chatModels = models.filter(m => !m.name.includes('embed') && !m.name.includes('minilm'))
  const embeddingModels = models.filter(m => m.name.includes('embed') || m.name.includes('minilm'))

  const isModelInstalled = (name: string) =>
    models.some(m => m.name === name || m.name.startsWith(name + ':'))

  const progressPercent =
    pullProgress?.total && pullProgress?.completed
      ? Math.round((pullProgress.completed / pullProgress.total) * 100)
      : null

  const chatModelChanged = localChatModel !== settings.selectedModel
  const embeddingModelChanged = localEmbeddingModel !== settings.embeddingModel

  const recommendedChat = RECOMMENDED_MODELS.filter(m => m.category === 'chat')
  const recommendedEmbedding = RECOMMENDED_MODELS.filter(m => m.category === 'embedding')

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Model</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure the local LLM and embedding models.
        </p>
      </div>

      {/* Low RAM warning banner */}
      {systemInfo && systemInfo.totalMemoryGB < 4 && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
          <p className="text-sm text-amber-200">
            Your system has limited RAM ({systemInfo.totalMemoryGB}GB). Small models may run slowly.
            Consider closing other applications while using Lore.
          </p>
        </div>
      )}

      {/* Section A: Ollama connection status */}
      <div className="rounded-lg border border-border p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span
              className={`size-2.5 rounded-full ${
                status.connected ? 'bg-emerald-500' : 'bg-red-500'
              }`}
            />
            <span className="text-sm font-medium text-foreground">
              {status.connected ? 'Connected to Ollama' : 'Ollama not connected'}
            </span>
          </div>
          <span className="text-xs text-muted-foreground">{settings.ollamaHost}</span>
        </div>
        {!status.connected && (
          <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <ExternalLink className="size-3" />
            <span>
              Install Ollama from{' '}
              <span className="text-primary underline">https://ollama.com</span>
              {' '}and make sure it's running.
            </span>
          </div>
        )}
      </div>

      {/* Hardware warnings */}
      {hardwareProfile && hardwareProfile.warnings.length > 0 && (
        <div className="space-y-2">
          {hardwareProfile.warnings.map((w, i) => (
            <div
              key={i}
              className="flex items-start gap-2.5 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-2.5"
            >
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
              <p className="text-xs text-amber-200/80">{w}</p>
            </div>
          ))}
        </div>
      )}

      {/* Section B: Model selection */}
      <div className="space-y-4">
        <ModelSelector
          label="Chat Model"
          description="The Ollama model used for chat and classification."
          models={chatModels}
          localValue={localChatModel}
          savedValue={settings.selectedModel}
          onLocalChange={setLocalChatModel}
          onSave={saveChatModel}
          saved={chatSaved}
          changed={chatModelChanged}
          disabled={!status.connected}
          noModelsMessage={
            status.connected
              ? 'No chat models installed. Download a model below to get started.'
              : 'Connect to Ollama to see installed models.'
          }
        />

        <ModelSelector
          label="Embedding Model"
          description="The model used to generate vector embeddings for search."
          models={embeddingModels}
          localValue={localEmbeddingModel}
          savedValue={settings.embeddingModel}
          onLocalChange={setLocalEmbeddingModel}
          onSave={saveEmbeddingModel}
          saved={embeddingSaved}
          changed={embeddingModelChanged}
          disabled={!status.connected}
          noModelsMessage={
            status.connected
              ? 'No embedding models installed. Download a model below to get started.'
              : 'Connect to Ollama to see installed models.'
          }
        />
      </div>

      {/* Section C: Installed models list */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-foreground">Installed Models</h3>
        {models.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {status.connected ? 'No models installed yet.' : 'Connect to Ollama to see models.'}
          </p>
        ) : (
          <div className="space-y-2">
            {models.map(model => (
              <div
                key={model.name}
                className="flex items-center justify-between rounded-lg border border-border px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-foreground">{model.name}</p>
                  <p className="text-xs text-muted-foreground">{formatBytes(model.size)}</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={deleteLoading === model.name}
                  onClick={() => handleDelete(model.name)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Section D: Download models */}
      <div className="space-y-5">
        <h3 className="text-sm font-medium text-foreground">Download Model</h3>

        {/* Custom model input */}
        <div className="flex gap-2">
          <Input
            value={pullName}
            onChange={e => setPullName(e.target.value)}
            placeholder="e.g. llama3.2:3b"
            className="max-w-xs"
            disabled={!!pullingModel || !status.connected}
            onKeyDown={e => e.key === 'Enter' && handlePull()}
          />
          <Button
            onClick={() => handlePull()}
            disabled={!pullName.trim() || !!pullingModel || !status.connected}
            size="sm"
          >
            <Download className="mr-1.5 size-4" />
            Download
          </Button>
        </div>

        {/* Progress bar for custom pull (only when not pulling a recommended model) */}
        {pullingModel && !RECOMMENDED_MODELS.some(m => m.name === pullingModel) && pullProgress && (
          <PullProgressBar progress={pullProgress} percent={progressPercent} />
        )}

        {pullError && !RECOMMENDED_MODELS.some(m => m.name === pullingModel) && (
          <p className="text-xs text-red-400">{pullError}</p>
        )}

        {/* Recommended chat models */}
        <div className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Chat Models
          </p>
          <div className="grid gap-2">
            {recommendedChat.map(rec => (
              <RecommendedModelCard
                key={rec.name}
                model={rec}
                installed={isModelInstalled(rec.name)}
                pulling={pullingModel === rec.name}
                pullProgress={pullingModel === rec.name ? pullProgress : null}
                pullPercent={pullingModel === rec.name ? progressPercent : null}
                pullError={pullingModel === rec.name ? pullError : null}
                anyPulling={!!pullingModel}
                connected={status.connected}
                hardwareProfile={hardwareProfile}
                systemInfo={systemInfo}
                onPull={() => handlePull(rec.name)}
              />
            ))}
          </div>
        </div>

        {/* Recommended embedding models */}
        <div className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Embedding Models
          </p>
          <div className="grid gap-2">
            {recommendedEmbedding.map(rec => (
              <RecommendedModelCard
                key={rec.name}
                model={rec}
                installed={isModelInstalled(rec.name)}
                pulling={pullingModel === rec.name}
                pullProgress={pullingModel === rec.name ? pullProgress : null}
                pullPercent={pullingModel === rec.name ? progressPercent : null}
                pullError={pullingModel === rec.name ? pullError : null}
                anyPulling={!!pullingModel}
                connected={status.connected}
                hardwareProfile={hardwareProfile}
                systemInfo={systemInfo}
                onPull={() => handlePull(rec.name)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Section E: System info */}
      {systemInfo && hardwareProfile && (
        <div className="rounded-lg border border-border">
          <button
            onClick={() => setSystemInfoOpen(o => !o)}
            className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-foreground hover:bg-muted/30"
          >
            {systemInfoOpen ? (
              <ChevronDown className="size-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-4 text-muted-foreground" />
            )}
            <Monitor className="size-4 text-muted-foreground" />
            System Info
          </button>
          {systemInfoOpen && (
            <div className="space-y-1.5 border-t border-border px-4 py-3 text-xs text-muted-foreground">
              <Row label="OS" value={`${platformDisplayName(systemInfo.platform, systemInfo.osVersion)} ${systemInfo.arch}`} />
              <Row label="CPU" value={`${systemInfo.cpuModel} (${systemInfo.cpuCores} cores)`} />
              <Row label="RAM" value={`${systemInfo.totalMemoryGB} GB total (${systemInfo.freeMemoryGB} GB available)`} />
              <Row label="GPU" value={gpuDisplayString(systemInfo.gpu, hardwareProfile)} />
              <Row label="Max recommended model" value={`${hardwareProfile.maxParametersBillions}B parameters`} />
            </div>
          )}
        </div>
      )}

      {/* Section F: Ollama host */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">
          Ollama Host
        </label>
        <Input
          value={settings.ollamaHost}
          onChange={e => onUpdate({ ollamaHost: e.target.value })}
          className="max-w-xs"
        />
        <p className="text-xs text-muted-foreground">
          The URL where Ollama is running (default: http://127.0.0.1:11434).
        </p>
      </div>
    </div>
  )
}

// ── Subcomponents ──────────────────────────────────────────────────

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <span className="w-40 shrink-0 font-medium text-foreground/70">{label}</span>
      <span>{value}</span>
    </div>
  )
}

function PullProgressBar({
  progress,
  percent,
}: {
  progress: PullProgress
  percent: number | null
}) {
  return (
    <div className="space-y-1.5">
      <div className="h-2 w-full max-w-xs overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full bg-primary transition-all duration-300"
          style={{ width: `${percent ?? 0}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {progress.status}
        {percent !== null && ` — ${percent}%`}
      </p>
    </div>
  )
}

interface ModelSelectorProps {
  label: string
  description: string
  models: OllamaModel[]
  localValue: string
  savedValue: string
  onLocalChange: (v: string) => void
  onSave: () => void
  saved: boolean
  changed: boolean
  disabled: boolean
  noModelsMessage: string
}

function ModelSelector({
  label,
  description,
  models,
  localValue,
  savedValue,
  onLocalChange,
  onSave,
  saved,
  changed,
  disabled,
  noModelsMessage,
}: ModelSelectorProps) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-foreground">{label}</label>
      {models.length > 0 ? (
        <div className="flex items-center gap-2">
          <select
            value={localValue}
            onChange={e => onLocalChange(e.target.value)}
            disabled={disabled}
            className={cn(
              'w-full max-w-xs rounded-md border px-3 py-2 text-sm transition-colors',
              'bg-background disabled:cursor-not-allowed disabled:opacity-50',
              !changed
                ? 'border-emerald-500/50 bg-emerald-500/10 text-foreground'
                : 'border-primary bg-primary/10 text-foreground',
            )}
          >
            <option value="">Select a model...</option>
            {models.map(m => (
              <option key={m.name} value={m.name}>
                {m.name} ({formatBytes(m.size)})
              </option>
            ))}
          </select>

          {changed && localValue && (
            <Button size="sm" onClick={onSave} className="shrink-0">
              Save
            </Button>
          )}

          {saved && (
            <span className="flex items-center gap-1 text-xs text-emerald-500">
              <Check className="size-3.5" /> Saved!
            </span>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{noModelsMessage}</p>
      )}
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  )
}

interface RecommendedModelCardProps {
  model: RecommendedModel
  installed: boolean
  pulling: boolean
  pullProgress: PullProgress | null
  pullPercent: number | null
  pullError: string | null
  anyPulling: boolean
  connected: boolean
  hardwareProfile: HardwareProfile | null
  systemInfo: SystemInfo | null
  onPull: () => void
}

function RecommendedModelCard({
  model,
  installed,
  pulling,
  pullProgress,
  pullPercent,
  pullError,
  anyPulling,
  connected,
  hardwareProfile,
  systemInfo,
  onPull,
}: RecommendedModelCardProps) {
  const compatible =
    !hardwareProfile || model.minRAMGB <= (systemInfo?.totalMemoryGB ?? 999)

  return (
    <div
      className={cn(
        'rounded-lg border px-4 py-3 transition-opacity',
        compatible ? 'border-border/50' : 'border-border/30 opacity-50',
      )}
    >
      <div className="flex items-center justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-foreground">{model.displayName}</p>
            <span className="text-xs text-muted-foreground">
              {model.name}
            </span>
            <span className="text-xs text-muted-foreground">({model.sizeOnDisk})</span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{model.description}</p>
          {model.gpuRecommended && (
            <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground/60">
              <Cpu className="size-3" />
              <span>GPU recommended</span>
            </div>
          )}
        </div>

        <div className="ml-3 shrink-0">
          {installed ? (
            <span className="flex items-center gap-1.5 text-xs text-emerald-500">
              <CircleCheck className="size-4" />
              Installed
            </span>
          ) : !compatible ? (
            <span className="flex items-center gap-1.5 text-xs text-amber-400">
              <AlertTriangle className="size-3.5" />
              <span className="max-w-[140px]">
                Requires {model.minRAMGB}GB RAM
              </span>
            </span>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              disabled={anyPulling || !connected}
              onClick={onPull}
            >
              <Download className="size-3.5" />
            </Button>
          )}
        </div>
      </div>

      {pulling && pullProgress && (
        <div className="mt-3">
          <PullProgressBar progress={pullProgress} percent={pullPercent} />
        </div>
      )}

      {pullError && !pulling && (
        <div className="mt-2 flex items-center justify-between">
          <p className="text-xs text-red-400">{pullError}</p>
          <Button
            variant="ghost"
            size="sm"
            onClick={onPull}
            disabled={anyPulling || !connected}
            className="text-xs"
          >
            Retry
          </Button>
        </div>
      )}
    </div>
  )
}
