import { useState, useCallback, useEffect, useRef } from 'react'
import type { ChatMessage } from '../../shared/types'

function createId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const streamingIdRef = useRef<string | null>(null)

  const clearMessages = useCallback(() => {
    setMessages([])
    setIsLoading(false)
    setStatusMessage(null)
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

    const cleanupStatus = window.loreAPI.onStatus((message: string) => {
      setStatusMessage(message)
    })

    const cleanupEnd = window.loreAPI.onResponseEnd(() => {
      const id = streamingIdRef.current
      if (id) {
        setMessages(prev =>
          prev.map(msg =>
            msg.id === id ? { ...msg, isStreaming: false } : msg,
          ),
        )
        streamingIdRef.current = null
      }
      setIsLoading(false)
      setStatusMessage(null)
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
      setStatusMessage(null)
    })

    return () => {
      cleanupReset()
      cleanupChunk()
      cleanupStatus()
      cleanupEnd()
      cleanupError()
    }
  }, [clearMessages])

  const messagesRef = useRef<ChatMessage[]>([])
  messagesRef.current = messages

  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || isLoading) return

      const history = messagesRef.current
        .filter(m => !m.isStreaming)
        .map(m => ({ role: m.role, content: m.content }))

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
      setIsLoading(true)
      setMessages(prev => [...prev, userMsg, assistantMsg])

      window.loreAPI.sendMessage(trimmed, history).catch(() => {
        streamingIdRef.current = null
        setIsLoading(false)
        setStatusMessage(null)
      })
    },
    [isLoading],
  )

  return { messages, isLoading, statusMessage, sendMessage, clearMessages }
}
