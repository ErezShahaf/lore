import { useRef } from 'react'
import { MessageList } from './MessageList'
import { InputBar } from './InputBar'
import { useChat } from '@/hooks/useChat'
import { useWindowResize } from '@/hooks/useWindowResize'

export function ChatWindow() {
  const { messages, isLoading, statusMessage, sendMessage } = useChat()
  const containerRef = useRef<HTMLDivElement>(null)

  useWindowResize(containerRef)

  return (
    <div className="flex h-screen flex-col overflow-hidden rounded-xl border border-border/30 bg-[#0e0e0e]/95 backdrop-blur-xl">
      <div ref={containerRef} className="flex min-h-0 flex-1 flex-col">
        <MessageList messages={messages} isLoading={isLoading} statusMessage={statusMessage} />
      </div>
      <InputBar onSend={sendMessage} disabled={isLoading} />
    </div>
  )
}
