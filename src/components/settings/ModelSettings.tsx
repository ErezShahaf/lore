import { useState, useEffect, useCallback, useMemo } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Download, Trash2, Check, CircleCheck, Star, X, FolderOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  RECOMMENDED_MODELS,
  pickBestVariant,
  sortModelsForSystem,
} from '../../../shared/models'
import type {
  AppSettings,
  OllamaModel,
  OllamaStatus,
  PullProgress,
  SystemInfo,
  HardwareProfile,
  RecommendedModel,
  ModelVariant,
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

export function ModelSettings({ settings, onUpdate }: ModelSettingsProps) {
  const [status, setStatus] = useState<OllamaStatus>({ connected: false })
  const [models, setModels] = useState<OllamaModel[]>([])
  const [activeDownloads, setActiveDownloads] = useState<Map<string, PullProgress>>(new Map())
  const [pullErrors, setPullErrors] = useState<Map<string, string>>(new Map())
  const [deleteLoading, setDeleteLoading] = useState<string | null>(null)
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null)
  const [hardwareProfile, setHardwareProfile] = useState<HardwareProfile | null>(null)

  const [localChatModel, setLocalChatModel] = useState(settings.selectedModel)
  const [localEmbeddingModel, setLocalEmbeddingModel] = useState(settings.embeddingModel)
  const [chatSaved, setChatSaved] = useState(false)
  const [embeddingSaved, setEmbeddingSaved] = useState(false)

  useEffect(() => { setLocalChatModel(settings.selectedModel) }, [settings.selectedModel])
  useEffect(() => { setLocalEmbeddingModel(settings.embeddingModel) }, [settings.embeddingModel])

  const totalMemoryGB = systemInfo?.totalMemoryGB ?? null

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
    window.loreAPI.getActivePulls().then((pulls) => {
      const map = new Map(Object.entries(pulls))
      if (map.size > 0) setActiveDownloads(map)
    })

    const cleanupProgress = window.loreAPI.onPullProgress((progress) => {
      setActiveDownloads(prev => {
        const next = new Map(prev)
        next.set(progress.model, { status: progress.status, digest: progress.digest, total: progress.total, completed: progress.completed })
        return next
      })
    })

    const cleanupComplete = window.loreAPI.onPullComplete((result) => {
      setActiveDownloads(prev => {
        const next = new Map(prev)
        next.delete(result.model)
        return next
      })
      if (!result.success && result.error) {
        setPullErrors(prev => new Map(prev).set(result.model, result.error!))
      }
      refreshModels()
    })

    return () => { cleanupProgress(); cleanupComplete() }
  }, [refreshModels])

  const handlePull = async (tag: string, category: 'chat' | 'embedding') => {
    if (!tag || activeDownloads.has(tag)) return

    setPullErrors(prev => { const next = new Map(prev); next.delete(tag); return next })
    setActiveDownloads(prev => new Map(prev).set(tag, { status: 'Starting download...' }))

    const result = await window.loreAPI.pullModel(tag)

    if (result.success) {
      await refreshModels()
      if (category === 'chat' && !settings.selectedModel) {
        onUpdate({ selectedModel: tag })
      }
      if (category === 'embedding' && !settings.embeddingModel) {
        onUpdate({ embeddingModel: tag })
      }
    }
  }

  const handleAbortPull = async (tag: string) => {
    await window.loreAPI.abortPull(tag)
  }

  const handlePickModelsFolder = async () => {
    const folder = await window.loreAPI.setupPickModelsFolder()
    if (folder) onUpdate({ ollamaModelsPath: folder })
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

  const isModelInstalled = (model: RecommendedModel) =>
    model.variants.some(v =>
      models.some(m => m.name === v.tag || m.name.startsWith(v.tag + ':'))
    )

  const chatModelChanged = localChatModel !== settings.selectedModel
  const embeddingModelChanged = localEmbeddingModel !== settings.embeddingModel

  const sortedChat = useMemo(
    () => sortModelsForSystem(
      RECOMMENDED_MODELS.filter(m => m.category === 'chat'),
      totalMemoryGB,
    ),
    [totalMemoryGB],
  )

  const sortedEmbedding = useMemo(
    () => sortModelsForSystem(
      RECOMMENDED_MODELS.filter(m => m.category === 'embedding'),
      totalMemoryGB,
    ),
    [totalMemoryGB],
  )

  const bestChatTag = sortedChat.length > 0
    ? pickBestVariant(sortedChat[0], totalMemoryGB).tag
    : null

  const bestEmbeddingTag = sortedEmbedding.length > 0
    ? pickBestVariant(sortedEmbedding[0], totalMemoryGB).tag
    : null

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Model</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your local AI models.
        </p>
      </div>

      {/* Status + model selection */}
      <div className="rounded-lg border border-border p-4 space-y-4">
        <div className="flex items-center gap-2">
          <span
            className={`size-2 rounded-full ${
              status.connected ? 'bg-emerald-500' : 'bg-red-500'
            }`}
          />
          <span className="text-xs text-muted-foreground">
            {status.connected ? 'Connected' : 'Not connected'}
          </span>
          {hardwareProfile?.gpuAcceleration && (
            <span className="text-xs text-muted-foreground">
              · {hardwareProfile.gpuAccelerationType.toUpperCase()} acceleration
            </span>
          )}
        </div>

        {/* Chat model dropdown */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">Chat Model</label>
          {chatModels.length > 0 ? (
            <div className="flex items-center gap-2">
              <select
                value={localChatModel}
                onChange={e => setLocalChatModel(e.target.value)}
                className={cn(
                  'w-full max-w-xs rounded-md border px-3 py-2 text-sm',
                  'bg-background text-foreground',
                  !chatModelChanged
                    ? 'border-emerald-500/50 bg-emerald-500/10'
                    : 'border-primary bg-primary/10',
                )}
              >
                <option value="">Select a model...</option>
                {chatModels.map(m => (
                  <option key={m.name} value={m.name}>
                    {m.name} ({formatBytes(m.size)})
                  </option>
                ))}
              </select>
              {chatModelChanged && localChatModel && (
                <Button size="sm" onClick={saveChatModel}>Save</Button>
              )}
              {chatSaved && (
                <span className="flex items-center gap-1 text-xs text-emerald-500">
                  <Check className="size-3.5" /> Saved!
                </span>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              No chat models installed — download one below.
            </p>
          )}
        </div>

        {/* Embedding model dropdown */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">Embedding Model</label>
          {embeddingModels.length > 0 ? (
            <div className="flex items-center gap-2">
              <select
                value={localEmbeddingModel}
                onChange={e => setLocalEmbeddingModel(e.target.value)}
                className={cn(
                  'w-full max-w-xs rounded-md border px-3 py-2 text-sm',
                  'bg-background text-foreground',
                  !embeddingModelChanged
                    ? 'border-emerald-500/50 bg-emerald-500/10'
                    : 'border-primary bg-primary/10',
                )}
              >
                <option value="">Select a model...</option>
                {embeddingModels.map(m => (
                  <option key={m.name} value={m.name}>
                    {m.name} ({formatBytes(m.size)})
                  </option>
                ))}
              </select>
              {embeddingModelChanged && localEmbeddingModel && (
                <Button size="sm" onClick={saveEmbeddingModel}>Save</Button>
              )}
              {embeddingSaved && (
                <span className="flex items-center gap-1 text-xs text-emerald-500">
                  <Check className="size-3.5" /> Saved!
                </span>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              No embedding models installed — download one below.
            </p>
          )}
        </div>
      </div>

      {/* Installed models with delete */}
      {models.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-foreground">Installed Models</h3>
          <div className="space-y-1.5">
            {models.map(model => (
              <div
                key={model.name}
                className="flex items-center justify-between rounded-lg border border-border px-4 py-2.5"
              >
                <div>
                  <p className="text-sm text-foreground">{model.name}</p>
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
        </div>
      )}

      {/* Download models */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-foreground">Download Models</h3>

        {/* Chat models */}
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Chat Models
          </p>
          {sortedChat.map(rec => {
            const variant = pickBestVariant(rec, totalMemoryGB)
            const progress = activeDownloads.get(variant.tag) ?? null
            const percent = progress?.total && progress?.completed
              ? Math.round((progress.completed / progress.total) * 100)
              : null
            return (
              <RecommendedModelCard
                key={variant.tag}
                model={rec}
                variant={variant}
                installed={isModelInstalled(rec)}
                isBest={variant.tag === bestChatTag}
                compatible={rec.variants[0].minRAMGB <= (totalMemoryGB ?? 999)}
                pulling={activeDownloads.has(variant.tag)}
                pullProgress={progress}
                pullPercent={percent}
                pullError={pullErrors.get(variant.tag) ?? null}
                onPull={() => handlePull(variant.tag, 'chat')}
                onAbort={() => handleAbortPull(variant.tag)}
              />
            )
          })}
        </div>

        {/* Embedding models */}
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Embedding Models
          </p>
          {sortedEmbedding.map(rec => {
            const variant = pickBestVariant(rec, totalMemoryGB)
            const progress = activeDownloads.get(variant.tag) ?? null
            const percent = progress?.total && progress?.completed
              ? Math.round((progress.completed / progress.total) * 100)
              : null
            return (
              <RecommendedModelCard
                key={variant.tag}
                model={rec}
                variant={variant}
                installed={isModelInstalled(rec)}
                isBest={variant.tag === bestEmbeddingTag}
                compatible={true}
                pulling={activeDownloads.has(variant.tag)}
                pullProgress={progress}
                pullPercent={percent}
                pullError={pullErrors.get(variant.tag) ?? null}
                onPull={() => handlePull(variant.tag, 'embedding')}
                onAbort={() => handleAbortPull(variant.tag)}
              />
            )
          })}
        </div>
      </div>

      {/* Model storage path */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">Model Storage Location</label>
        <div className="flex gap-2">
          <div className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-muted-foreground truncate font-mono">
            {settings.ollamaModelsPath || 'Default (managed by Ollama)'}
          </div>
          <Button variant="outline" size="sm" onClick={handlePickModelsFolder}>
            <FolderOpen className="size-4" />
            Browse
          </Button>
          {settings.ollamaModelsPath && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onUpdate({ ollamaModelsPath: '' })}
              className="text-muted-foreground hover:text-destructive"
            >
              <X className="size-4" />
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Where downloaded AI models are stored. Requires restarting the app to take effect.
        </p>
      </div>

      {/* AI engine host */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">AI Engine Host</label>
        <Input
          value={settings.ollamaHost}
          onChange={e => onUpdate({ ollamaHost: e.target.value })}
          className="max-w-xs"
        />
        <p className="text-xs text-muted-foreground">
          The URL where the local AI engine is running (default: http://127.0.0.1:11434).
        </p>
      </div>
    </div>
  )
}

// ── Subcomponents ──────────────────────────────────────────────────

interface RecommendedModelCardProps {
  model: RecommendedModel
  variant: ModelVariant
  installed: boolean
  isBest: boolean
  compatible: boolean
  pulling: boolean
  pullProgress: PullProgress | null
  pullPercent: number | null
  pullError: string | null
  onPull: () => void
  onAbort: () => void
}

function RecommendedModelCard({
  model,
  variant,
  installed,
  isBest,
  compatible,
  pulling,
  pullProgress,
  pullPercent,
  pullError,
  onPull,
  onAbort,
}: RecommendedModelCardProps) {
  return (
    <div
      className={cn(
        'rounded-lg border px-4 py-3',
        isBest && !installed ? 'border-primary/40 bg-primary/5' : 'border-border/50',
        !compatible && 'opacity-50',
      )}
    >
      <div className="flex items-center justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium text-foreground">{model.displayName}</p>
            <span className="text-xs text-muted-foreground">
              {variant.tag}
            </span>
            <span className="text-xs text-muted-foreground">
              {variant.sizeOnDisk}
            </span>
            {variant.quantization !== 'Default' && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {variant.quantization}
              </span>
            )}
            {isBest && !installed && (
              <span className="flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
                <Star className="size-2.5" />
                Best for your system
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{model.description}</p>
          {!compatible && (
            <p className="mt-1 text-xs text-amber-400">
              Requires at least {model.variants[0].minRAMGB}GB RAM
            </p>
          )}
        </div>

        <div className="ml-3 shrink-0">
          {installed ? (
            <span className="flex items-center gap-1.5 text-xs text-emerald-500">
              <CircleCheck className="size-4" />
              Installed
            </span>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              disabled={pulling}
              onClick={onPull}
            >
              <Download className="size-4" />
            </Button>
          )}
        </div>
      </div>

      {pulling && pullProgress && (
        <div className="mt-3 space-y-1.5">
          <div className="flex items-center gap-2">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
              {pullPercent !== null ? (
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{ width: `${pullPercent}%` }}
                />
              ) : (
                <div
                  className="h-full w-[40%] rounded-full bg-primary/70"
                  style={{ animation: 'indeterminate 1.5s ease-in-out infinite' }}
                />
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onAbort}
              className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive shrink-0"
            >
              <X className="size-3.5" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {pullProgress.status}
            {pullPercent !== null && ` — ${pullPercent}%`}
          </p>
        </div>
      )}

      {pullError && !pulling && (
        <div className="mt-2 flex items-center justify-between">
          <p className="text-xs text-red-400">{pullError}</p>
          <Button
            variant="ghost"
            size="sm"
            onClick={onPull}
            disabled={pulling}
            className="text-xs"
          >
            Retry
          </Button>
        </div>
      )}
    </div>
  )
}
