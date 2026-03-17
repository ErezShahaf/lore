import { useEffect, useRef } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { MessageBubble, TypingIndicator } from './MessageBubble'
import type { ChatMessage } from '../../../shared/types'

const SCROLL_THRESHOLD_PX = 80
const USER_SCROLL_THRESHOLD_PX = 20

function isScrolledToBottom(viewport: HTMLDivElement, threshold = SCROLL_THRESHOLD_PX): boolean {
  const { scrollTop, scrollHeight, clientHeight } = viewport
  return scrollHeight - scrollTop - clientHeight <= threshold
}

interface MessageListProps {
  messages: ChatMessage[]
  isLoading: boolean
  statusMessage?: string | null
}

function EmptyState() {
  return (
    <div className="animate-fade-in flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-8 text-center">
      <p className="text-sm text-muted-foreground">
        Store a thought, ask a question, or manage your todos.
      </p>
      <p className="mt-1 text-xs text-muted-foreground/60">
        Press <kbd className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-foreground/70">Shift+Space</kbd> to toggle
      </p>
    </div>
  )
}

export function MessageList({ messages, isLoading, statusMessage }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const shouldAutoFollowRef = useRef(true)
  const userMessageCountRef = useRef(0)
  const previousMessageSignatureRef = useRef('')

  const scrollToBottom = (behavior: ScrollBehavior): void => {
    bottomRef.current?.scrollIntoView({ behavior })
  }

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    const handleScroll = (): void => {
      shouldAutoFollowRef.current = isScrolledToBottom(viewport, USER_SCROLL_THRESHOLD_PX)
    }

    viewport.addEventListener('scroll', handleScroll, { passive: true })
    return () => viewport.removeEventListener('scroll', handleScroll)
  }, [])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    const userMessageCount = messages.filter(m => m.role === 'user').length
    const isNewUserMessage = userMessageCount > userMessageCountRef.current
    if (isNewUserMessage) {
      userMessageCountRef.current = userMessageCount
      shouldAutoFollowRef.current = true
      scrollToBottom('smooth')
      previousMessageSignatureRef.current = messages.map((message) => message.id).join('|')
      return
    }

    const messageSignature = messages.map((message) => message.id).join('|')
    const hasNewMessage = messageSignature !== previousMessageSignatureRef.current
    previousMessageSignatureRef.current = messageSignature

    if (!shouldAutoFollowRef.current) return

    scrollToBottom(hasNewMessage ? 'smooth' : 'auto')
  }, [messages, isLoading, statusMessage])

  if (messages.length === 0 && !isLoading) return <EmptyState />

  return (
    <ScrollArea className="flex min-h-0 min-w-0 flex-1 overflow-hidden" viewportRef={viewportRef}>
      <div className="flex min-w-0 max-w-full flex-col gap-3 overflow-x-hidden px-6 py-4">
        {messages.map(msg => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {statusMessage && (
          <div className="animate-fade-in flex justify-start">
            <span className="text-xs italic text-muted-foreground">{statusMessage}</span>
          </div>
        )}
        {isLoading && !messages.some(m => m.isStreaming) && !statusMessage && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  )
}
