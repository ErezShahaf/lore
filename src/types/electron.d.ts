import type { AppSettings, OllamaModel, OllamaStatus, PullProgress, DatabaseStats, RetrievalOptions, SystemInfo, HardwareProfile } from '../../shared/types'

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

      getSystemInfo: () => Promise<SystemInfo>
      getHardwareProfile: () => Promise<HardwareProfile>

      getOllamaStatus: () => Promise<OllamaStatus>
      listModels: () => Promise<OllamaModel[]>
      pullModel: (name: string) => Promise<{ success: boolean; error?: string }>
      onPullProgress: (callback: (progress: PullProgress) => void) => () => void
      deleteModel: (name: string) => Promise<{ success: boolean; error?: string }>
      onOllamaStatusChange: (callback: (status: OllamaStatus) => void) => () => void

      getSettings: () => Promise<AppSettings>
      updateSettings: (settings: Partial<AppSettings>) => Promise<AppSettings>
      onSettingsChanged: (callback: (settings: AppSettings) => void) => () => void

      getDbStats: () => Promise<DatabaseStats>
      searchDocuments: (query: string, options?: RetrievalOptions) => Promise<unknown[]>
      getDocumentsByType: (type: string) => Promise<unknown[]>
    }
  }
}
