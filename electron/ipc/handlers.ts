import { ipcMain, BrowserWindow } from 'electron'
import { resizeChatWindow, hideChatWindow } from '../windows/chatWindow'
import { getSettings, updateSettings } from '../services/settingsService'
import {
  checkConnection,
  listModels,
  pullModel,
  deleteModel,
  chat,
} from '../services/ollamaService'
import type { ChatRequest } from '../../shared/types'

const SYSTEM_PROMPT =
  'You are Lore, a personal knowledge assistant. You help the user capture thoughts and answer questions about their stored knowledge. Be concise and helpful.'

export function registerIpcHandlers(): void {
  ipcMain.handle('ping', () => 'pong')

  ipcMain.on('chat:resize', (_event, { height }: { height: number }) => {
    resizeChatWindow(height)
  })

  ipcMain.on('chat:hide', () => {
    hideChatWindow()
  })

  // ── Streaming chat ──────────────────────────────────────────────

  ipcMain.handle(
    'chat:send',
    async (
      event,
      { message, history }: {
        message: string
        history?: Array<{ role: 'user' | 'assistant'; content: string }>
      },
    ) => {
      const sender = event.sender
      const settings = getSettings()

      const status = await checkConnection()
      if (!status.connected) {
        sender.send('chat:response-error', {
          error: 'Ollama is not running. Please start Ollama and try again.',
        })
        return null
      }

      const messages: ChatRequest['messages'] = [
        { role: 'system', content: SYSTEM_PROMPT },
      ]

      if (history) {
        for (const msg of history) {
          messages.push({ role: msg.role, content: msg.content })
        }
      }

      messages.push({ role: 'user', content: message })

      try {
        const stream = chat({
          model: settings.selectedModel,
          messages,
          stream: true,
        })

        for await (const chunk of stream) {
          sender.send('chat:response-chunk', { chunk })
        }

        sender.send('chat:response-end')
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'An unexpected error occurred'
        sender.send('chat:response-error', { error: errorMessage })
      }

      return null
    },
  )

  // ── Ollama management ───────────────────────────────────────────

  ipcMain.handle('ollama:status', async () => {
    return checkConnection()
  })

  ipcMain.handle('ollama:list-models', async () => {
    try {
      return await listModels()
    } catch {
      return []
    }
  })

  ipcMain.handle('ollama:pull-model', async (event, { name }: { name: string }) => {
    const sender = event.sender
    try {
      await pullModel(name, (progress) => {
        sender.send('ollama:pull-progress', progress)
      })
      return { success: true }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Pull failed',
      }
    }
  })

  ipcMain.handle('ollama:delete-model', async (_event, { name }: { name: string }) => {
    try {
      await deleteModel(name)
      return { success: true }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Delete failed',
      }
    }
  })

  // ── Settings ────────────────────────────────────────────────────

  ipcMain.handle('settings:get', () => {
    return getSettings()
  })

  ipcMain.handle('settings:update', (_event, partial) => {
    const updated = updateSettings(partial)
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('settings:changed', updated)
    }
    return updated
  })
}
