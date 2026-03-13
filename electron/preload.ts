import { contextBridge, ipcRenderer } from 'electron'
import type { AppSettings, OllamaModel, OllamaStatus, PullProgress } from '../shared/types'

const loreAPI = {
  ping: () => ipcRenderer.invoke('ping'),

  resizeChatWindow: (height: number) =>
    ipcRenderer.send('chat:resize', { height }),

  hideChatWindow: () => ipcRenderer.send('chat:hide'),

  sendMessage: (
    message: string,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>,
  ): Promise<null> =>
    ipcRenderer.invoke('chat:send', { message, history }),

  onMessageChunk: (callback: (chunk: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, { chunk }: { chunk: string }) =>
      callback(chunk)
    ipcRenderer.on('chat:response-chunk', handler)
    return () => ipcRenderer.removeListener('chat:response-chunk', handler)
  },

  onResponseEnd: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('chat:response-end', handler)
    return () => ipcRenderer.removeListener('chat:response-end', handler)
  },

  onResponseError: (callback: (error: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, { error }: { error: string }) =>
      callback(error)
    ipcRenderer.on('chat:response-error', handler)
    return () => ipcRenderer.removeListener('chat:response-error', handler)
  },

  onChatReset: (callback: () => void) => {
    ipcRenderer.on('chat:reset', callback)
    return () => ipcRenderer.removeListener('chat:reset', callback)
  },

  // ── Ollama management ───────────────────────────────────────

  getOllamaStatus: (): Promise<OllamaStatus> =>
    ipcRenderer.invoke('ollama:status'),

  listModels: (): Promise<OllamaModel[]> =>
    ipcRenderer.invoke('ollama:list-models'),

  pullModel: (name: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('ollama:pull-model', { name }),

  onPullProgress: (callback: (progress: PullProgress) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, progress: PullProgress) =>
      callback(progress)
    ipcRenderer.on('ollama:pull-progress', handler)
    return () => ipcRenderer.removeListener('ollama:pull-progress', handler)
  },

  deleteModel: (name: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('ollama:delete-model', { name }),

  onOllamaStatusChange: (callback: (status: OllamaStatus) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, status: OllamaStatus) =>
      callback(status)
    ipcRenderer.on('ollama:status-changed', handler)
    return () => ipcRenderer.removeListener('ollama:status-changed', handler)
  },

  // ── Settings ────────────────────────────────────────────────

  getSettings: (): Promise<AppSettings> =>
    ipcRenderer.invoke('settings:get'),

  updateSettings: (settings: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke('settings:update', settings),

  onSettingsChanged: (callback: (settings: AppSettings) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, settings: AppSettings) =>
      callback(settings)
    ipcRenderer.on('settings:changed', handler)
    return () => ipcRenderer.removeListener('settings:changed', handler)
  },
}

contextBridge.exposeInMainWorld('loreAPI', loreAPI)

declare global {
  interface Window {
    loreAPI: typeof loreAPI
  }
}
