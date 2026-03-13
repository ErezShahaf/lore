import { useState, useCallback, useEffect, useRef } from 'react'
import type { ChatMessage } from '../../shared/types'

function createId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const streamingIdRef = useRef<string | null>(null)

  const clearMessages = useCallback(() => {
    setMessages([])
    setIsLoading(false)
    streamingIdRef.current = null
  }, [])

  useEffect(() => {
    const cleanupReset = window.loreAPI.onChatReset(() => {
      clearMessages()
    })

    const cleanupChunk = window.loreAPI.onMessageChunk((chunk: string) => {
      const id = streamingIdRef.current
      if (!id) return

      setMessages(prev =>
        prev.map(msg =>
          msg.id === id ? { ...msg, content: msg.content + chunk } : msg,
        ),
      )
    })

    const cleanupEnd = window.loreAPI.onResponseEnd(() => {
      const id = streamingIdRef.current
      if (!id) return

      setMessages(prev =>
        prev.map(msg =>
          msg.id === id ? { ...msg, isStreaming: false } : msg,
        ),
      )
      streamingIdRef.current = null
      setIsLoading(false)
    })

    const cleanupError = window.loreAPI.onResponseError((error: string) => {
      const id = streamingIdRef.current
      if (id) {
        setMessages(prev =>
          prev.map(msg =>
            msg.id === id
              ? { ...msg, content: error, isStreaming: false }
              : msg,
          ),
        )
      } else {
        setMessages(prev => [
          ...prev,
          {
            id: createId(),
            role: 'assistant',
            content: error,
            timestamp: new Date().toISOString(),
          },
        ])
      }
      streamingIdRef.current = null
      setIsLoading(false)
    })

    return () => {
      cleanupReset()
      cleanupChunk()
      cleanupEnd()
      cleanupError()
    }
  }, [clearMessages])

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || isLoading) return

      const userMsg: ChatMessage = {
        id: createId(),
        role: 'user',
        content: trimmed,
        timestamp: new Date().toISOString(),
      }

      const assistantId = createId()
      const assistantMsg: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString(),
        isStreaming: true,
      }

      streamingIdRef.current = assistantId

      setMessages(prev => {
        const history = prev
          .filter(m => !m.isStreaming)
          .map(m => ({ role: m.role, content: m.content }))

        window.loreAPI.sendMessage(trimmed, history)

        return [...prev, userMsg, assistantMsg]
      })

      setIsLoading(true)
    },
    [isLoading],
  )

  return { messages, isLoading, sendMessage, clearMessages }
}
