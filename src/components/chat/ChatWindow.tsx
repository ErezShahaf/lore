import { useRef, useState, useEffect, useLayoutEffect, useCallback } from 'react'
import { Settings, X, ExternalLink } from 'lucide-react'
import { MessageList } from './MessageList'
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

export function ChatWindow() {
  const { messages, isLoading, statusMessage, sendMessage } = useChat()
  const containerRef = useRef<HTMLDivElement>(null)
  const setupState = useSetupStatus()
  const [isClosing, setIsClosing] = useState(false)
  const [showUpdateDialog, setShowUpdateDialog] = useState(false)
  const [latestVersion, setLatestVersion] = useState<string | null>(null)
  const updateCheckDoneRef = useRef(false)
  const isLinuxPlatform = navigator.userAgent.toLowerCase().includes('linux')

  useWindowResize(containerRef)

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
      if (isLinuxPlatform) {
        window.loreAPI.minimizeChatWindowWithReset()
      } else {
        window.loreAPI.hideChatWindow()
      }
    }
  }, [isLinuxPlatform])

  const chatDisabled = setupState.status !== 'ready' || isLoading
  const disabledReason =
    setupState.status === 'setting-up'
      ? 'AI engine is starting up...'
      : setupState.status === 'needs-models'
        ? 'Set up models in Settings to start chatting'
        : undefined

  return (
    <div className={`${isClosing ? 'h-screen' : 'animate-float h-screen'} p-6`}>
      <div
        className={`${isClosing ? 'animate-scale-out' : 'animate-scale-in'} relative flex h-full flex-col gap-2 overflow-hidden rounded-2xl border border-border/30 bg-[#0e0e0e]/95 backdrop-blur-xl [filter:drop-shadow(0_4px_12px_rgba(0,0,0,0.35))]`}
        onAnimationEnd={handleAnimationEnd}
      >
        <div className="absolute right-3 top-3 z-10 flex items-center gap-1">
          <button
            onClick={() => window.loreAPI.openSettings()}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            aria-label="Open settings"
          >
            <Settings className="size-3.5" />
          </button>
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
          ) : (
            <MessageList messages={messages} isLoading={isLoading} statusMessage={statusMessage} />
          )}
        </div>
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
