import { useRef, useState, useEffect, useLayoutEffect, useCallback } from 'react'
import { Settings, X, ExternalLink } from 'lucide-react'
import { MessageList } from './MessageList'
import { ThinkingStream } from './ThinkingStream'
import { InputBar } from './InputBar'
import { useChat } from '@/hooks/useChat'
import { useWindowResize } from '@/hooks/useWindowResize'
import { useSetupStatus } from '@/hooks/useSetupStatus'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { compareSemver } from '@/lib/semver'
import { THINKING_STRIP_LAYOUT_RESERVE_PX } from '../../../shared/chatWindowConstants'

const LORE_REPO_URL = 'https://github.com/ErezShahaf/Lore'
const UPDATE_PROMPT_INTERVAL_MS = 2.5 * 24 * 60 * 60 * 1000

function SetupProgress({ percent, message }: { percent: number; message: string }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-xs space-y-4 text-center">
        <p className="text-sm font-medium text-foreground">Setting up AI engine...</p>
        <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{ width: `${percent}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground">{message}</p>
      </div>
    </div>
  )
}

function NeedsModels({ missingChat, missingEmbedding }: { missingChat: boolean; missingEmbedding: boolean }) {
  const missing = [
    missingChat && 'chat model',
    missingEmbedding && 'embedding model',
  ].filter(Boolean)

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-xs space-y-4 text-center">
        <p className="text-sm font-medium text-foreground">Almost there!</p>
        <p className="text-xs text-muted-foreground">
          You need to set up {missing.join(' and a')} to get started.
          Head to Settings to download and select your models.
        </p>
        <button
          onClick={() => window.loreAPI.openSettings()}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Settings className="size-4" />
          Open Settings
        </button>
      </div>
    </div>
  )
}

function MigrationProgress({
  processed,
  total,
  toModel,
}: {
  processed: number
  total: number
  toModel: string
}) {
  const percent = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-xs space-y-4 text-center">
        <p className="text-sm font-medium text-foreground">
          Migrating to {toModel}
        </p>
        <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{ width: `${percent}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Re-embedding {processed.toLocaleString()} of {total.toLocaleString()} documents.
          Please keep the app open and your computer awake.
        </p>
      </div>
    </div>
  )
}

function MigrationError({
  message,
  toModel,
}: {
  message: string
  toModel: string
}) {
  const [isBusy, setIsBusy] = useState(false)

  const handleRetry = async (): Promise<void> => {
    setIsBusy(true)
    try {
      await window.loreAPI.retryEmbeddingMigration()
    } finally {
      setIsBusy(false)
    }
  }

  const handleDiscard = async (): Promise<void> => {
    setIsBusy(true)
    try {
      await window.loreAPI.discardEmbeddingMigration()
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-4 text-center">
        <p className="text-sm font-medium text-foreground">
          Migration to {toModel} failed
        </p>
        <p className="break-words rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-left text-xs text-destructive">
          {message}
        </p>
        <p className="text-xs text-muted-foreground">
          If the embedding model is no longer available, reinstall it from Settings or pick a
          different one. If the problem keeps happening, please report it on the Lore repository.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <button
            onClick={handleRetry}
            disabled={isBusy}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            Retry
          </button>
          <button
            onClick={() => window.loreAPI.openSettings()}
            disabled={isBusy}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-secondary px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary/80 disabled:opacity-50"
          >
            <Settings className="size-3.5" />
            Open Settings
          </button>
          <button
            onClick={handleDiscard}
            disabled={isBusy}
            className="inline-flex items-center gap-2 rounded-md border border-destructive/30 px-3 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
          >
            Discard and keep previous model
          </button>
        </div>
      </div>
    </div>
  )
}

export function ChatWindow() {
  const { messages, isLoading, thinkingPaneText, sendMessage } = useChat()
  const containerRef = useRef<HTMLDivElement>(null)
  const setupState = useSetupStatus()
  const [isClosing, setIsClosing] = useState(false)
  const [showUpdateDialog, setShowUpdateDialog] = useState(false)
  const [latestVersion, setLatestVersion] = useState<string | null>(null)
  const updateCheckDoneRef = useRef(false)

  useLayoutEffect(() => {
    document.documentElement.dataset.window = 'chat'
  }, [])

  useEffect(() => {
    return window.loreAPI.onChatShown(() => {
      setIsClosing(false)
    })
  }, [])

  useEffect(() => {
    const runUpdateCheck = async (): Promise<void> => {
      if (updateCheckDoneRef.current) return
      const currentVersion = import.meta.env.VITE_APP_VERSION
      if (typeof currentVersion !== 'string') return
      try {
        const [result, lastShownAt] = await Promise.all([
          window.loreAPI.getLatestVersion(),
          window.loreAPI.getLastUpdatePromptShownAt(),
        ])
        if (result === null) return
        const comparison = compareSemver(result.version, currentVersion)
        if (comparison !== 1) return
        const now = Date.now()
        const shouldShow =
          lastShownAt === null || now - lastShownAt > UPDATE_PROMPT_INTERVAL_MS
        if (shouldShow) {
          updateCheckDoneRef.current = true
          setLatestVersion(result.version)
          setShowUpdateDialog(true)
        }
      } catch {
        // Ignore; do not block or surface errors
      }
    }
    const cleanup = window.loreAPI.onChatShown(() => {
      runUpdateCheck()
    })
    runUpdateCheck()
    return cleanup
  }, [])

  const handleUpdateDialogClose = useCallback(() => {
    setShowUpdateDialog(false)
    setLatestVersion(null)
    window.loreAPI.setLastUpdatePromptShownAt()
  }, [])

  useEffect(() => {
    return window.loreAPI.onChatWillHide(() => {
      setIsClosing(true)
    })
  }, [])

  const handleRequestClose = useCallback(() => {
    setIsClosing(true)
  }, [])

  const handleAnimationEnd = useCallback((event: React.AnimationEvent) => {
    if (event.animationName === 'scale-out') {
      setIsClosing(false)
      window.loreAPI.hideChatWindow()
    }
  }, [])

  const hasStreamingAssistantMessage = messages.some(
    (message) => message.role === 'assistant' && message.isStreaming === true,
  )

  const reserveThinkingStripLayoutSlot =
    setupState.status === 'ready' && isLoading && hasStreamingAssistantMessage

  useWindowResize(containerRef, {
    extraBottomContentHeightPx: reserveThinkingStripLayoutSlot
      ? THINKING_STRIP_LAYOUT_RESERVE_PX
      : 0,
  })

  const chatDisabled = setupState.status !== 'ready' || isLoading
  const disabledReason =
    setupState.status === 'setting-up'
      ? 'AI engine is starting up...'
      : setupState.status === 'needs-models'
        ? 'Set up models in Settings to start chatting'
        : setupState.status === 'migrating'
          ? `Migrating documents to ${setupState.toModel}. Please keep the app open.`
          : setupState.status === 'migration-error'
            ? 'Embedding migration failed. Resolve it to continue.'
            : undefined

  return (
    <div className={`${isClosing ? 'h-screen' : 'animate-float h-screen'} p-6`}>
      <div
        className={`${isClosing ? 'animate-scale-out' : 'animate-scale-in'} relative flex h-full flex-col gap-2 overflow-hidden rounded-2xl border border-border/30 bg-[#0e0e0e]/95 backdrop-blur-xl [filter:drop-shadow(0_4px_12px_rgba(0,0,0,0.35))]`}
        onAnimationEnd={handleAnimationEnd}
      >
        <div className="absolute right-3 top-3 z-10">
          <button
            onClick={handleRequestClose}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            aria-label="Close chat"
          >
            <X className="size-3.5" />
          </button>
        </div>
        <div ref={containerRef} className="flex min-h-0 flex-1 flex-col">
          {setupState.status === 'setting-up' ? (
            <SetupProgress percent={setupState.percent} message={setupState.message} />
          ) : setupState.status === 'needs-models' ? (
            <NeedsModels
              missingChat={setupState.missingChat}
              missingEmbedding={setupState.missingEmbedding}
            />
          ) : setupState.status === 'migrating' ? (
            <MigrationProgress
              processed={setupState.processed}
              total={setupState.total}
              toModel={setupState.toModel}
            />
          ) : setupState.status === 'migration-error' ? (
            <MigrationError
              message={setupState.message}
              toModel={setupState.toModel}
            />
          ) : (
            <MessageList messages={messages} isLoading={isLoading} />
          )}
        </div>
        {setupState.status === 'ready' ? (
          <ThinkingStream
            text={thinkingPaneText}
            isAwaitingFirstPipelineTrace={
              isLoading && hasStreamingAssistantMessage && thinkingPaneText.length === 0
            }
          />
        ) : null}
        <InputBar
          onSend={sendMessage}
          onRequestClose={handleRequestClose}
          disabled={chatDisabled}
          disabledReason={disabledReason}
        />
      </div>

      <Dialog open={showUpdateDialog} onOpenChange={(open) => !open && handleUpdateDialogClose()}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Update available</DialogTitle>
            <DialogDescription>
              A new version of Lore ({latestVersion ?? ''}) is available. You can download it from
              the repository.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter showCloseButton>
            <Button variant="outline" onClick={handleUpdateDialogClose}>
              Later
            </Button>
            <Button
              onClick={() => {
                window.loreAPI.openExternal(LORE_REPO_URL)
                handleUpdateDialogClose()
              }}
            >
              <ExternalLink className="size-4" />
              Open GitHub
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
