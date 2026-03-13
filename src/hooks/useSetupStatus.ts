import { useState, useEffect, useCallback } from 'react'
import type { OllamaSetupProgress, OllamaStatus, AppSettings } from '../../shared/types'

export type SetupState =
  | { status: 'setting-up'; phase: OllamaSetupProgress['phase']; percent: number; message: string }
  | { status: 'needs-models'; missingChat: boolean; missingEmbedding: boolean }
  | { status: 'ready' }

export function useSetupStatus(): SetupState {
  const [setupProgress, setSetupProgress] = useState<OllamaSetupProgress | null>(null)
  const [ollamaConnected, setOllamaConnected] = useState(false)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [installedModelNames, setInstalledModelNames] = useState<string[]>([])

  const refreshModels = useCallback(async () => {
    try {
      const models = await window.loreAPI.listModels()
      setInstalledModelNames(models.map(m => m.name))
    } catch {
      setInstalledModelNames([])
    }
  }, [])

  useEffect(() => {
    window.loreAPI.getOllamaStatus().then(s => setOllamaConnected(s.connected))
    window.loreAPI.getSettings().then(setSettings)
    refreshModels()

    const cleanupSetup = window.loreAPI.onSetupProgress((progress) => {
      setSetupProgress(progress)
      if (progress.phase === 'ready') {
        setOllamaConnected(true)
        refreshModels()
      }
    })

    const cleanupStatus = window.loreAPI.onOllamaStatusChange((status: OllamaStatus) => {
      setOllamaConnected(status.connected)
      if (status.connected) refreshModels()
    })

    const cleanupSettings = window.loreAPI.onSettingsChanged((updated: AppSettings) => {
      setSettings(updated)
      refreshModels()
    })

    return () => {
      cleanupSetup()
      cleanupStatus()
      cleanupSettings()
    }
  }, [refreshModels])

  if (!ollamaConnected && setupProgress && setupProgress.phase !== 'ready') {
    return {
      status: 'setting-up',
      phase: setupProgress.phase,
      percent: setupProgress.percent,
      message: setupProgress.message,
    }
  }

  if (!ollamaConnected && !setupProgress) {
    return {
      status: 'setting-up',
      phase: 'downloading',
      percent: 0,
      message: 'Connecting to AI engine...',
    }
  }

  if (settings) {
    const chatModel = settings.selectedModel
    const embeddingModel = settings.embeddingModel

    const chatInstalled = chatModel
      && installedModelNames.some(n => n === chatModel || n.startsWith(chatModel + ':'))
    const embeddingInstalled = embeddingModel
      && installedModelNames.some(n => n === embeddingModel || n.startsWith(embeddingModel + ':'))

    if (!chatInstalled || !embeddingInstalled) {
      return {
        status: 'needs-models',
        missingChat: !chatInstalled,
        missingEmbedding: !embeddingInstalled,
      }
    }
  }

  return { status: 'ready' }
}
