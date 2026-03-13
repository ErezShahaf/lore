import { ipcMain, BrowserWindow } from 'electron'
import { resizeChatWindow, hideChatWindow } from '../windows/chatWindow'
import { getSettings, updateSettings } from '../services/settingsService'
import {
  checkConnection,
  listModels,
  pullModel,
  deleteModel,
} from '../services/ollamaService'
import { getStats } from '../services/lanceService'
import { retrieveRelevantDocuments } from '../services/documentPipeline'
import { getDocumentsByType } from '../services/lanceService'
import { processUserInput, clearConversation } from '../services/agentService'
import type { RetrievalOptions } from '../../shared/types'

export function registerIpcHandlers(): void {
  ipcMain.handle('ping', () => 'pong')

  ipcMain.on('chat:resize', (_event, { height }: { height: number }) => {
    resizeChatWindow(height)
  })

  ipcMain.on('chat:hide', () => {
    clearConversation()
    hideChatWindow()
  })

  // ── Streaming chat (agent pipeline) ────────────────────────────

  ipcMain.handle(
    'chat:send',
    async (
      event,
      { message }: {
        message: string
        history?: Array<{ role: 'user' | 'assistant'; content: string }>
      },
    ) => {
      const sender = event.sender

      const status = await checkConnection()
      if (!status.connected) {
        sender.send('chat:response-error', {
          error: 'Ollama is not running. Please start Ollama and try again.',
        })
        return null
      }

      try {
        const generator = processUserInput(message)

        for await (const agentEvent of generator) {
          switch (agentEvent.type) {
            case 'chunk':
              sender.send('chat:response-chunk', { chunk: agentEvent.content })
              break
            case 'status':
              sender.send('chat:status', { message: agentEvent.message })
              break
            case 'error':
              sender.send('chat:response-error', { error: agentEvent.message })
              break
            case 'stored':
            case 'deleted':
            case 'duplicate':
              break
            case 'done':
              sender.send('chat:response-end')
              break
          }
        }
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

  // ── Database ──────────────────────────────────────────────────

  ipcMain.handle('db:stats', async () => {
    try {
      return await getStats()
    } catch (err) {
      return {
        totalDocuments: 0,
        deletedDocuments: 0,
        documentsByType: {},
        error: err instanceof Error ? err.message : 'Failed to get stats',
      }
    }
  })

  ipcMain.handle(
    'db:search',
    async (_event, { query, options }: { query: string; options?: RetrievalOptions }) => {
      try {
        const docs = await retrieveRelevantDocuments(query, options)
        return docs.map((d) => ({ ...d, vector: undefined }))
      } catch (err) {
        return { error: err instanceof Error ? err.message : 'Search failed' }
      }
    },
  )

  ipcMain.handle('db:get-by-type', async (_event, { type }: { type: string }) => {
    try {
      const docs = await getDocumentsByType(type)
      return docs.map((d) => ({ ...d, vector: undefined }))
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Query failed' }
    }
  })
}
