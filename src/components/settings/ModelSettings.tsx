import { useState, useEffect, useCallback } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Download, Trash2, ExternalLink } from 'lucide-react'
import type { AppSettings, OllamaModel, OllamaStatus, PullProgress } from '../../../shared/types'

interface ModelSettingsProps {
  settings: AppSettings
  onUpdate: (partial: Partial<AppSettings>) => void
}

const SUGGESTED_MODELS = [
  { name: 'llama3.2:3b', size: '~2 GB', desc: 'Good balance of speed & quality' },
  { name: 'mistral:7b', size: '~4 GB', desc: 'Higher quality, needs more RAM' },
  { name: 'nomic-embed-text', size: '~274 MB', desc: 'Fast, high-quality embeddings' },
]

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function ModelSettings({ settings, onUpdate }: ModelSettingsProps) {
  const [status, setStatus] = useState<OllamaStatus>({ connected: false })
  const [models, setModels] = useState<OllamaModel[]>([])
  const [pullName, setPullName] = useState('')
  const [pulling, setPulling] = useState(false)
  const [pullProgress, setPullProgress] = useState<PullProgress | null>(null)
  const [pullError, setPullError] = useState<string | null>(null)
  const [deleteLoading, setDeleteLoading] = useState<string | null>(null)

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

    const cleanupStatus = window.loreAPI.onOllamaStatusChange((s) => {
      setStatus(s)
      refreshModels()
    })

    return cleanupStatus
  }, [refreshStatus, refreshModels])

  useEffect(() => {
    if (!pulling) return
    const cleanup = window.loreAPI.onPullProgress((progress) => {
      setPullProgress(progress)
    })
    return cleanup
  }, [pulling])

  const handlePull = async (name?: string) => {
    const modelName = name ?? pullName.trim()
    if (!modelName || pulling) return

    setPulling(true)
    setPullError(null)
    setPullProgress({ status: 'Starting download...' })

    const result = await window.loreAPI.pullModel(modelName)

    if (!result.success) {
      setPullError(result.error ?? 'Failed to pull model')
    } else {
      setPullName('')
      await refreshModels()
    }

    setPulling(false)
    setPullProgress(null)
  }

  const handleDelete = async (name: string) => {
    setDeleteLoading(name)
    const result = await window.loreAPI.deleteModel(name)
    if (result.success) {
      await refreshModels()

      if (settings.selectedModel === name) {
        onUpdate({ selectedModel: '' })
      }
      if (settings.embeddingModel === name) {
        onUpdate({ embeddingModel: '' })
      }
    }
    setDeleteLoading(null)
  }

  const chatModels = models.filter(m => !m.name.includes('embed'))
  const embeddingModels = models.filter(m => m.name.includes('embed'))

  const progressPercent =
    pullProgress?.total && pullProgress?.completed
      ? Math.round((pullProgress.completed / pullProgress.total) * 100)
      : null

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Model</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure the local LLM and embedding models.
        </p>
      </div>

      {/* Ollama status */}
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

      {/* Model selection */}
      <div className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">
            Chat Model
          </label>
          {chatModels.length > 0 ? (
            <select
              value={settings.selectedModel}
              onChange={e => onUpdate({ selectedModel: e.target.value })}
              className="w-full max-w-xs rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              <option value="">Select a model...</option>
              {chatModels.map(m => (
                <option key={m.name} value={m.name}>
                  {m.name} ({formatBytes(m.size)})
                </option>
              ))}
            </select>
          ) : (
            <Input value={settings.selectedModel} onChange={e => onUpdate({ selectedModel: e.target.value })} className="max-w-xs" />
          )}
          <p className="text-xs text-muted-foreground">
            The Ollama model used for chat and classification.
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">
            Embedding Model
          </label>
          {embeddingModels.length > 0 ? (
            <select
              value={settings.embeddingModel}
              onChange={e => onUpdate({ embeddingModel: e.target.value })}
              className="w-full max-w-xs rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              <option value="">Select a model...</option>
              {embeddingModels.map(m => (
                <option key={m.name} value={m.name}>
                  {m.name} ({formatBytes(m.size)})
                </option>
              ))}
            </select>
          ) : (
            <Input value={settings.embeddingModel} onChange={e => onUpdate({ embeddingModel: e.target.value })} className="max-w-xs" />
          )}
          <p className="text-xs text-muted-foreground">
            The model used to generate vector embeddings for search.
          </p>
        </div>
      </div>

      {/* Installed models */}
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

      {/* Pull new model */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-foreground">Download Model</h3>
        <div className="flex gap-2">
          <Input
            value={pullName}
            onChange={e => setPullName(e.target.value)}
            placeholder="e.g. llama3.2:3b"
            className="max-w-xs"
            disabled={pulling}
            onKeyDown={e => e.key === 'Enter' && handlePull()}
          />
          <Button
            onClick={() => handlePull()}
            disabled={!pullName.trim() || pulling || !status.connected}
            size="sm"
          >
            <Download className="mr-1.5 size-4" />
            Download
          </Button>
        </div>

        {pulling && pullProgress && (
          <div className="space-y-1.5">
            <div className="h-2 w-full max-w-xs overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${progressPercent ?? 0}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {pullProgress.status}
              {progressPercent !== null && ` — ${progressPercent}%`}
            </p>
          </div>
        )}

        {pullError && (
          <p className="text-xs text-red-400">{pullError}</p>
        )}

        {/* Suggested models */}
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Recommended models:</p>
          {SUGGESTED_MODELS.map(sm => {
            const installed = models.some(m => m.name === sm.name)
            return (
              <div
                key={sm.name}
                className="flex items-center justify-between rounded-md border border-border/50 px-3 py-2"
              >
                <div>
                  <p className="text-sm text-foreground">
                    {sm.name}{' '}
                    <span className="text-xs text-muted-foreground">({sm.size})</span>
                  </p>
                  <p className="text-xs text-muted-foreground">{sm.desc}</p>
                </div>
                {installed ? (
                  <span className="text-xs text-emerald-500">Installed</span>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pulling || !status.connected}
                    onClick={() => handlePull(sm.name)}
                  >
                    <Download className="size-3.5" />
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Ollama host config */}
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
