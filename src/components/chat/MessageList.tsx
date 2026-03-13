import { useEffect, useRef } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { MessageBubble, TypingIndicator } from './MessageBubble'
import type { ChatMessage } from '../../../shared/types'

interface MessageListProps {
  messages: ChatMessage[]
  isLoading: boolean
  statusMessage?: string | null
}

export function MessageList({ messages, isLoading, statusMessage }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading, statusMessage])

  if (messages.length === 0 && !isLoading) return null

  return (
    <ScrollArea className="flex-1 overflow-hidden">
      <div className="flex flex-col gap-3 p-4">
        {messages.map(msg => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {statusMessage && (
          <div className="flex justify-start">
            <span className="text-xs italic text-muted-foreground">{statusMessage}</span>
          </div>
        )}
        {isLoading && !messages.some(m => m.isStreaming) && !statusMessage && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  )
}
