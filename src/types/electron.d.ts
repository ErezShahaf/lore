import type { AppSettings, OllamaModel, OllamaStatus, PullProgress } from '../../shared/types'

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
      onChatReset: (callback: () => void) => () => void

      getOllamaStatus: () => Promise<OllamaStatus>
      listModels: () => Promise<OllamaModel[]>
      pullModel: (name: string) => Promise<{ success: boolean; error?: string }>
      onPullProgress: (callback: (progress: PullProgress) => void) => () => void
      deleteModel: (name: string) => Promise<{ success: boolean; error?: string }>
      onOllamaStatusChange: (callback: (status: OllamaStatus) => void) => () => void

      getSettings: () => Promise<AppSettings>
      updateSettings: (settings: Partial<AppSettings>) => Promise<AppSettings>
      onSettingsChanged: (callback: (settings: AppSettings) => void) => () => void
    }
  }
}
