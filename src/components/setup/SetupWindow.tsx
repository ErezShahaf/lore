import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import {
  FolderOpen,
  ArrowRight,
  Download,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  RefreshCw,
} from 'lucide-react'
import type { OllamaSetupProgress } from '../../../shared/types'

type Step = 'welcome' | 'installing'

export function SetupWindow() {
  const [step, setStep] = useState<Step>('welcome')
  const [installPath, setInstallPath] = useState('')
  const [modelsPath, setModelsPath] = useState('')
  const [progress, setProgress] = useState<OllamaSetupProgress | null>(null)

  useEffect(() => {
    window.loreAPI.setupGetDefaultPath().then(setInstallPath)
  }, [])

  useEffect(() => {
    return window.loreAPI.onSetupProgress(setProgress)
  }, [])

  const handlePickFolder = async () => {
    const folder = await window.loreAPI.setupPickFolder()
    if (folder) setInstallPath(folder)
  }

  const handlePickModelsFolder = async () => {
    const folder = await window.loreAPI.setupPickModelsFolder()
    if (folder) setModelsPath(folder)
  }

  const handleNext = async () => {
    setStep('installing')
    await window.loreAPI.setupBegin(installPath, modelsPath || undefined)
  }

  const handleGetStarted = () => {
    window.loreAPI.setupComplete()
  }

  const handleRetry = () => {
    setProgress(null)
    window.loreAPI.setupBegin(installPath)
  }

  if (step === 'installing') {
    return (
      <ProgressView
        progress={progress}
        onComplete={handleGetStarted}
        onRetry={handleRetry}
      />
    )
  }

  return (
    <WelcomeView
      installPath={installPath}
      modelsPath={modelsPath}
      onPickFolder={handlePickFolder}
      onPickModelsFolder={handlePickModelsFolder}
      onNext={handleNext}
    />
  )
}

function WelcomeView({
  installPath,
  modelsPath,
  onPickFolder,
  onPickModelsFolder,
  onNext,
}: {
  installPath: string
  modelsPath: string
  onPickFolder: () => void
  onPickModelsFolder: () => void
  onNext: () => void
}) {
  return (
    <div className="flex flex-col h-screen bg-background text-foreground p-8 select-none">
      <div className="flex-1 flex flex-col items-center justify-center gap-6">
        <div className="flex items-center gap-3">
          <Sparkles className="size-8 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Welcome to Lore</h1>
        </div>

        <div className="w-full max-w-md bg-card rounded-xl border border-border p-5 space-y-3">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Download className="size-4 text-primary" />
            About Ollama
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Lore uses{' '}
            <strong className="text-foreground">Ollama</strong> to run AI
            models locally on your machine. Ollama is a free, open-source
            engine that manages and runs large language models.
          </p>
          <ul className="text-sm text-muted-foreground space-y-1.5 pt-1">
            <li className="flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-primary shrink-0" />
              Completely free and open-source
            </li>
            <li className="flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-primary shrink-0" />
              Everything runs locally on your computer
            </li>
            <li className="flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-primary shrink-0" />
              No data is ever sent to the cloud
            </li>
          </ul>
        </div>

        <div className="w-full max-w-md space-y-2">
          <label className="text-sm font-medium text-foreground">
            Engine location
          </label>
          <div className="flex gap-2">
            <div className="flex-1 bg-card border border-border rounded-lg px-3 py-2.5 text-sm text-muted-foreground truncate font-mono">
              {installPath || '...'}
            </div>
            <Button variant="outline" onClick={onPickFolder}>
              <FolderOpen className="size-4" />
              Browse
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Where to install the Ollama engine.
          </p>
        </div>

        <div className="w-full max-w-md space-y-2">
          <label className="text-sm font-medium text-foreground">
            Model storage
          </label>
          <div className="flex gap-2">
            <div className="flex-1 bg-card border border-border rounded-lg px-3 py-2.5 text-sm text-muted-foreground truncate font-mono">
              {modelsPath || 'Default (managed by Ollama)'}
            </div>
            <Button variant="outline" onClick={onPickModelsFolder}>
              <FolderOpen className="size-4" />
              Browse
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Where to store downloaded AI models. Models can be several GB each.
          </p>
        </div>
      </div>

      <div className="flex justify-end pt-4">
        <Button onClick={onNext} size="lg" disabled={!installPath}>
          Next
          <ArrowRight className="size-4 ml-1" />
        </Button>
      </div>
    </div>
  )
}

function ProgressView({
  progress,
  onComplete,
  onRetry,
}: {
  progress: OllamaSetupProgress | null
  onComplete: () => void
  onRetry: () => void
}) {
  const phase = progress?.phase ?? 'downloading'
  const percent = progress?.percent ?? 0
  const message = progress?.message ?? 'Preparing...'
  const isReady = phase === 'ready'
  const isError = phase === 'error'

  return (
    <div className="flex flex-col h-screen bg-background text-foreground p-8 select-none">
      <div className="flex-1 flex flex-col items-center justify-center gap-6">
        {isReady ? (
          <>
            <CheckCircle2 className="size-14 text-green-500 animate-scale-in" />
            <div className="text-center space-y-1">
              <h1 className="text-2xl font-bold tracking-tight">All Set!</h1>
              <p className="text-muted-foreground">
                Ollama is installed and ready to go.
              </p>
            </div>
            <Button onClick={onComplete} size="lg" className="mt-2">
              Get Started
              <ArrowRight className="size-4 ml-1" />
            </Button>
          </>
        ) : isError ? (
          <>
            <AlertCircle className="size-14 text-destructive" />
            <div className="text-center space-y-1">
              <h1 className="text-2xl font-bold tracking-tight">
                Setup Failed
              </h1>
              <p className="text-sm text-muted-foreground max-w-sm">
                {message}
              </p>
            </div>
            <Button onClick={onRetry} variant="outline" size="lg" className="mt-2">
              <RefreshCw className="size-4" />
              Try Again
            </Button>
          </>
        ) : (
          <>
            <Download className="size-12 text-primary animate-pulse" />
            <div className="text-center space-y-1">
              <h1 className="text-2xl font-bold tracking-tight">
                Setting Up Ollama
              </h1>
              <p className="text-sm text-muted-foreground">
                This may take a few minutes
              </p>
            </div>
            <div className="w-full max-w-sm space-y-3">
              <div className="w-full h-3 bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${Math.max(2, percent)}%` }}
                />
              </div>
              <p className="text-sm text-muted-foreground text-center">
                {message}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
