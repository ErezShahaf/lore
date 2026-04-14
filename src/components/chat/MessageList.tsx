import { useEffect, useLayoutEffect, useRef } from 'react'
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

export function MessageList({ messages, isLoading }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const shouldAutoFollowRef = useRef(true)
  const userMessageCountRef = useRef(0)
  const previousMessageSignatureRef = useRef('')
  const isProgrammaticScrollRef = useRef(false)

  const scrollToBottom = (): void => {
    isProgrammaticScrollRef.current = true
    bottomRef.current?.scrollIntoView({ behavior: 'auto' })
  }

  // On initial render messages is empty, so EmptyState is shown and ScrollArea is not yet
  // mounted — viewportRef.current is null. We must re-run this effect the first time
  // ScrollArea actually enters the DOM (when the first message / loading state appears).
  const isScrollAreaMounted = messages.length > 0 || isLoading

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    shouldAutoFollowRef.current = isScrolledToBottom(viewport, USER_SCROLL_THRESHOLD_PX)

    const handleWheel = (event: WheelEvent): void => {
      if (event.deltaY < 0) {
        shouldAutoFollowRef.current = false
      }
    }

    const handleScroll = (): void => {
      // Ignore scroll events produced by our own programmatic scrollToBottom calls.
      // Without this guard, a queued programmatic scroll event can fire after a wheel-up
      // and incorrectly re-enable follow.
      if (isProgrammaticScrollRef.current) {
        isProgrammaticScrollRef.current = false
        return
      }
      shouldAutoFollowRef.current = isScrolledToBottom(viewport, USER_SCROLL_THRESHOLD_PX)
    }

    viewport.addEventListener('wheel', handleWheel, { passive: true })
    viewport.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      viewport.removeEventListener('wheel', handleWheel)
      viewport.removeEventListener('scroll', handleScroll)
    }
  }, [isScrollAreaMounted])

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    const userMessageCount = messages.filter(m => m.role === 'user').length

    if (messages.length === 0) {
      userMessageCountRef.current = 0
      shouldAutoFollowRef.current = true
      previousMessageSignatureRef.current = ''
      return
    }

    const isNewUserMessage = userMessageCount > userMessageCountRef.current
    userMessageCountRef.current = userMessageCount
    if (isNewUserMessage) {
      shouldAutoFollowRef.current = true
      scrollToBottom()
      previousMessageSignatureRef.current = messages.map((message) => message.id).join('|')
      return
    }

    previousMessageSignatureRef.current = messages.map((message) => message.id).join('|')

    if (!shouldAutoFollowRef.current) return

    scrollToBottom()
  }, [messages, isLoading])

  if (messages.length === 0 && !isLoading) return <EmptyState />

  return (
    <ScrollArea className="flex min-h-0 min-w-0 flex-1 overflow-hidden" viewportRef={viewportRef}>
      <div className="flex min-w-0 max-w-full flex-col gap-3 overflow-x-hidden px-6 py-4">
        {messages.map(msg => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {isLoading && !messages.some(m => m.isStreaming) && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  )
}
