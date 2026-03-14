import { useRef, useState, useEffect, useLayoutEffect, useCallback } from 'react'
import { Settings, X } from 'lucide-react'
import { MessageList } from './MessageList'
import { InputBar } from './InputBar'
import { useChat } from '@/hooks/useChat'
import { useWindowResize } from '@/hooks/useWindowResize'
import { useSetupStatus } from '@/hooks/useSetupStatus'

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
        className={`${isClosing ? 'animate-scale-out' : 'animate-scale-in'} relative flex h-full flex-col overflow-hidden rounded-2xl border border-border/30 bg-[#0e0e0e]/95 backdrop-blur-xl [filter:drop-shadow(0_4px_12px_rgba(0,0,0,0.35))]`}
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
    </div>
  )
}
