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
} from '../../shared/types'

declare global {
  interface Window {
    loreAPI: {
      ping: () => Promise<string>
      resizeChatWindow: (height: number) => void
      hideChatWindow: () => void

      sendMessage: (
        message: string,
        history?: Array<{ role: 'user' | 'assistant'; content: string }>,
      ) => Promise<null>
      onMessageChunk: (callback: (chunk: string) => void) => () => void
      onResponseEnd: (callback: () => void) => () => void
      onResponseError: (callback: (error: string) => void) => () => void
      onStatus: (callback: (message: string) => void) => () => void
      onChatReset: (callback: () => void) => () => void
      onChatShown: (callback: () => void) => () => void
      onChatWillHide: (callback: () => void) => () => void

      getSystemInfo: () => Promise<SystemInfo>
      getHardwareProfile: () => Promise<HardwareProfile>

      getOllamaStatus: () => Promise<OllamaStatus>
      listModels: () => Promise<OllamaModel[]>
      pullModel: (name: string, category?: 'chat' | 'embedding') => Promise<{ success: boolean; error?: string }>
      getActivePulls: () => Promise<Record<string, PullProgress>>
      onPullProgress: (callback: (progress: ActivePullProgress) => void) => () => void
      onPullComplete: (callback: (result: { model: string; success: boolean; error?: string }) => void) => () => void
      deleteModel: (name: string) => Promise<{ success: boolean; error?: string }>
      abortPull: (name: string) => Promise<{ success: boolean }>
      onOllamaStatusChange: (callback: (status: OllamaStatus) => void) => () => void
      onSetupProgress: (callback: (progress: OllamaSetupProgress) => void) => () => void
      openSettings: () => Promise<void>

      setupGetDefaultPath: () => Promise<string>
      setupPickFolder: () => Promise<string | null>
      setupPickModelsFolder: () => Promise<string | null>
      setupBegin: (ollamaPath: string, ollamaModelsPath?: string) => Promise<{ success: boolean }>
      setupComplete: () => Promise<void>

      getSettings: () => Promise<AppSettings>
      getDisplays: () => Promise<DisplayInfo[]>
      updateSettings: (settings: Partial<AppSettings>) => Promise<AppSettings>
      onSettingsChanged: (callback: (settings: AppSettings) => void) => () => void

      closeWindow: () => void
      minimizeWindow: () => void
      openExternal: (url: string) => void

      getDbStats: () => Promise<DatabaseStats>
      searchDocuments: (query: string, options?: RetrievalOptions) => Promise<unknown[]>
      getDocumentsByType: (type: string) => Promise<unknown[]>

      getLatestVersion: () => Promise<{ version: string } | null>
      getLastUpdatePromptShownAt: () => Promise<number | null>
      setLastUpdatePromptShownAt: () => Promise<void>
    }
  }
}
