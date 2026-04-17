import { useState, useCallback, useEffect, useRef } from 'react'
import type { ChatMessage } from '../../shared/types'

/** Shorter waits usually mean the model is already resident; longer waits often mean load from disk. */
const LOADING_MODEL_HINT_DELAY_MS = 1500

function createId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [thinkingPaneText, setThinkingPaneText] = useState('')
  const [loadingModelDelayed, setLoadingModelDelayed] = useState(false)
  const [likelyChatModelEvictedThisTurn, setLikelyChatModelEvictedThisTurn] = useState(false)
  const [hasChatModelInferenceCompletedThisTurn, setHasChatModelInferenceCompletedThisTurn] =
    useState(false)
  const streamingIdRef = useRef<string | null>(null)
  const loadingModelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isFirstModelThinkingChunkReference = useRef(true)
  const loadingModelLineAppendedReference = useRef(false)

  const resetThinkingPaneAuxiliaryReferences = useCallback((): void => {
    isFirstModelThinkingChunkReference.current = true
    loadingModelLineAppendedReference.current = false
  }, [])

  const clearLoadingModelTimer = useCallback((): void => {
    if (loadingModelTimerRef.current !== null) {
      clearTimeout(loadingModelTimerRef.current)
      loadingModelTimerRef.current = null
    }
  }, [])

  const clearMessages = useCallback(() => {
    clearLoadingModelTimer()
    setLoadingModelDelayed(false)
    setLikelyChatModelEvictedThisTurn(false)
    setHasChatModelInferenceCompletedThisTurn(false)
    setMessages([])
    setIsLoading(false)
    setThinkingPaneText('')
    resetThinkingPaneAuxiliaryReferences()
    streamingIdRef.current = null
  }, [clearLoadingModelTimer, resetThinkingPaneAuxiliaryReferences])

  useEffect(() => {
    const cleanupReset = window.loreAPI.onChatReset(() => {
      clearMessages()
    })

    const cleanupChunk = window.loreAPI.onMessageChunk((chunk: string) => {
      const id = streamingIdRef.current
      if (!id) return

      if (chunk.length > 0) {
        setThinkingPaneText('')
        resetThinkingPaneAuxiliaryReferences()
      }
      setMessages(prev =>
        prev.map(msg =>
          msg.id === id ? { ...msg, content: msg.content + chunk } : msg,
        ),
      )
    })

    const cleanupThinkingChunk = window.loreAPI.onThinkingChunk((chunk: string) => {
      if (!streamingIdRef.current) return
      setThinkingPaneText((previous) => {
        let prefix = ''
        if (isFirstModelThinkingChunkReference.current) {
          isFirstModelThinkingChunkReference.current = false
          if (previous.length > 0 && !previous.endsWith('\n')) {
            prefix = '\n'
          }
        }
        return previous + prefix + chunk
      })
    })

    const cleanupLikelyEvicted = window.loreAPI.onLikelyChatModelEvicted((likely: boolean) => {
      setLikelyChatModelEvictedThisTurn(likely)
    })

    const cleanupInferenceCompleted = window.loreAPI.onChatModelInferenceCompleted(() => {
      clearLoadingModelTimer()
      setLoadingModelDelayed(false)
      setHasChatModelInferenceCompletedThisTurn(true)
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
      setThinkingPaneText('')
      resetThinkingPaneAuxiliaryReferences()
      setLikelyChatModelEvictedThisTurn(false)
      setHasChatModelInferenceCompletedThisTurn(false)
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
      setThinkingPaneText('')
      resetThinkingPaneAuxiliaryReferences()
      setLikelyChatModelEvictedThisTurn(false)
      setHasChatModelInferenceCompletedThisTurn(false)
    })

    return () => {
      cleanupReset()
      cleanupChunk()
      cleanupThinkingChunk()
      cleanupLikelyEvicted()
      cleanupInferenceCompleted()
      cleanupEnd()
      cleanupError()
    }
  }, [clearLoadingModelTimer, clearMessages, resetThinkingPaneAuxiliaryReferences])

  useEffect(() => {
    clearLoadingModelTimer()
    setLoadingModelDelayed(false)

    if (!isLoading || !likelyChatModelEvictedThisTurn || hasChatModelInferenceCompletedThisTurn) {
      return
    }

    const streamingAssistant = messages.find(
      (message) => message.role === 'assistant' && message.isStreaming === true,
    )
    if (!streamingAssistant || streamingAssistant.content.length > 0) {
      return
    }

    loadingModelTimerRef.current = setTimeout(() => {
      setLoadingModelDelayed(true)
      loadingModelTimerRef.current = null
    }, LOADING_MODEL_HINT_DELAY_MS)

    return () => {
      clearLoadingModelTimer()
    }
  }, [
    isLoading,
    messages,
    likelyChatModelEvictedThisTurn,
    hasChatModelInferenceCompletedThisTurn,
    clearLoadingModelTimer,
  ])

  useEffect(() => {
    if (!isLoading || streamingIdRef.current === null) return
    if (
      !likelyChatModelEvictedThisTurn
      || !loadingModelDelayed
      || hasChatModelInferenceCompletedThisTurn
    ) {
      return
    }
    if (loadingModelLineAppendedReference.current) return
    loadingModelLineAppendedReference.current = true
    setThinkingPaneText((previous) =>
      previous.includes('Loading model…')
        ? previous
        : previous + (previous.length > 0 ? '\n' : '') + 'Loading model…',
    )
  }, [
    isLoading,
    likelyChatModelEvictedThisTurn,
    loadingModelDelayed,
    hasChatModelInferenceCompletedThisTurn,
  ])

  useEffect(() => {
    if (!hasChatModelInferenceCompletedThisTurn) return
    if (!loadingModelLineAppendedReference.current) return
    loadingModelLineAppendedReference.current = false
    setThinkingPaneText((previous) =>
      previous.replace(/\nLoading model…$/, '').replace(/^Loading model…$/, ''),
    )
  }, [hasChatModelInferenceCompletedThisTurn])

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
      setLikelyChatModelEvictedThisTurn(false)
      setHasChatModelInferenceCompletedThisTurn(false)
      setIsLoading(true)
      setThinkingPaneText('')
      resetThinkingPaneAuxiliaryReferences()
      setMessages(prev => [...prev, userMsg, assistantMsg])

      window.loreAPI.sendMessage(trimmed, history).catch(() => {
        streamingIdRef.current = null
        setIsLoading(false)
        setThinkingPaneText('')
        resetThinkingPaneAuxiliaryReferences()
        setLikelyChatModelEvictedThisTurn(false)
        setHasChatModelInferenceCompletedThisTurn(false)
      })
    },
    [isLoading, resetThinkingPaneAuxiliaryReferences],
  )

  return {
    messages,
    isLoading,
    thinkingPaneText,
    sendMessage,
    clearMessages,
  }
}
