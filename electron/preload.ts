import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSettings,
  OllamaModel,
  OllamaStatus,
  OllamaSetupProgress,
  PullProgress,
  ActivePullProgress,
  DisplayInfo,
  DatabaseStats,
  RetrievalOptions,
  SystemInfo,
  HardwareProfile,
} from '../shared/types'

const loreAPI = {
  ping: () => ipcRenderer.invoke('ping'),

  resizeChatWindow: (height: number) =>
    ipcRenderer.send('chat:resize', { height }),

  hideChatWindow: () => ipcRenderer.send('chat:hide'),
  minimizeChatWindowWithReset: () => ipcRenderer.send('chat:minimize-with-reset'),

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

  onThinkingChunk: (callback: (chunk: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, { chunk }: { chunk: string }) =>
      callback(chunk)
    ipcRenderer.on('chat:thinking-chunk', handler)
    return () => ipcRenderer.removeListener('chat:thinking-chunk', handler)
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

  onStatus: (callback: (message: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, { message }: { message: string }) =>
      callback(message)
    ipcRenderer.on('chat:status', handler)
    return () => ipcRenderer.removeListener('chat:status', handler)
  },

  onLikelyChatModelEvicted: (callback: (likely: boolean) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, { likely }: { likely: boolean }) =>
      callback(likely)
    ipcRenderer.on('chat:likely-chat-model-evicted', handler)
    return () => ipcRenderer.removeListener('chat:likely-chat-model-evicted', handler)
  },

  onChatModelInferenceCompleted: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('chat:model-inference-completed', handler)
    return () => ipcRenderer.removeListener('chat:model-inference-completed', handler)
  },

  onChatReset: (callback: () => void) => {
    ipcRenderer.on('chat:reset', callback)
    return () => ipcRenderer.removeListener('chat:reset', callback)
  },

  onChatShown: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('chat:shown', handler)
    return () => ipcRenderer.removeListener('chat:shown', handler)
  },

  onChatWillHide: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('chat:will-hide', handler)
    return () => ipcRenderer.removeListener('chat:will-hide', handler)
  },

  // ── System info ─────────────────────────────────────────────

  getSystemInfo: (): Promise<SystemInfo> =>
    ipcRenderer.invoke('system:info'),

  getHardwareProfile: (): Promise<HardwareProfile> =>
    ipcRenderer.invoke('system:hardware-profile'),

  // ── Ollama management ───────────────────────────────────────

  getOllamaStatus: (): Promise<OllamaStatus> =>
    ipcRenderer.invoke('ollama:status'),

  listModels: (): Promise<OllamaModel[]> =>
    ipcRenderer.invoke('ollama:list-models'),

  pullModel: (name: string, category?: 'chat' | 'embedding'): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('ollama:pull-model', { name, category }),

  getActivePulls: (): Promise<Record<string, PullProgress>> =>
    ipcRenderer.invoke('ollama:active-pulls'),

  onPullProgress: (callback: (progress: ActivePullProgress) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, progress: ActivePullProgress) =>
      callback(progress)
    ipcRenderer.on('ollama:pull-progress', handler)
    return () => ipcRenderer.removeListener('ollama:pull-progress', handler)
  },

  onPullComplete: (callback: (result: { model: string; success: boolean; error?: string }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, result: { model: string; success: boolean; error?: string }) =>
      callback(result)
    ipcRenderer.on('ollama:pull-complete', handler)
    return () => ipcRenderer.removeListener('ollama:pull-complete', handler)
  },

  deleteModel: (name: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('ollama:delete-model', { name }),

  abortPull: (name: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('ollama:abort-pull', { name }),

  onOllamaStatusChange: (callback: (status: OllamaStatus) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, status: OllamaStatus) =>
      callback(status)
    ipcRenderer.on('ollama:status-changed', handler)
    return () => ipcRenderer.removeListener('ollama:status-changed', handler)
  },

  onSetupProgress: (callback: (progress: OllamaSetupProgress) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, progress: OllamaSetupProgress) =>
      callback(progress)
    ipcRenderer.on('ollama:setup-progress', handler)
    return () => ipcRenderer.removeListener('ollama:setup-progress', handler)
  },

  openSettings: () => ipcRenderer.invoke('settings:open'),

  // ── Setup wizard ──────────────────────────────────────────────

  setupGetDefaultPath: (): Promise<string> =>
    ipcRenderer.invoke('setup:get-default-path'),

  setupPickFolder: (): Promise<string | null> =>
    ipcRenderer.invoke('setup:pick-folder'),

  setupPickModelsFolder: (): Promise<string | null> =>
    ipcRenderer.invoke('setup:pick-models-folder'),

  setupBegin: (ollamaPath: string, ollamaModelsPath?: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('setup:begin', { ollamaPath, ollamaModelsPath }),

  setupComplete: (): Promise<void> =>
    ipcRenderer.invoke('setup:complete'),

  // ── Settings ────────────────────────────────────────────────

  getSettings: (): Promise<AppSettings> =>
    ipcRenderer.invoke('settings:get'),

  getDisplays: (): Promise<DisplayInfo[]> =>
    ipcRenderer.invoke('window:list-displays'),

  updateSettings: (settings: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke('settings:update', settings),

  onSettingsChanged: (callback: (settings: AppSettings) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, settings: AppSettings) =>
      callback(settings)
    ipcRenderer.on('settings:changed', handler)
    return () => ipcRenderer.removeListener('settings:changed', handler)
  },

  // ── Database ──────────────────────────────────────────────

  closeWindow: () => ipcRenderer.send('window:close'),
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  openExternal: (url: string) => ipcRenderer.send('window:open-external', url),

  getDbStats: (): Promise<DatabaseStats> =>
    ipcRenderer.invoke('db:stats'),

  searchDocuments: (
    query: string,
    options?: RetrievalOptions,
  ): Promise<unknown[]> =>
    ipcRenderer.invoke('db:search', { query, options }),

  getDocumentsByType: (type: string): Promise<unknown[]> =>
    ipcRenderer.invoke('db:get-by-type', { type }),

  // ── Update check ──────────────────────────────────────────────

  getLatestVersion: (): Promise<{ version: string } | null> =>
    ipcRenderer.invoke('update:get-latest-version'),

  getLastUpdatePromptShownAt: (): Promise<number | null> =>
    ipcRenderer.invoke('update:get-last-prompt-shown'),

  setLastUpdatePromptShownAt: (): Promise<void> =>
    ipcRenderer.invoke('update:set-last-prompt-shown'),
}

contextBridge.exposeInMainWorld('loreAPI', loreAPI)

declare global {
  interface Window {
    loreAPI: typeof loreAPI
  }
}
