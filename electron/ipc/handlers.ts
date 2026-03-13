import { ipcMain, BrowserWindow } from 'electron'
import { resizeChatWindow, hideChatWindow } from '../windows/chatWindow'
import { getSettings, updateSettings } from '../services/settingsService'
import { setAutoStart } from '../services/autoStartService'
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
import { getSystemInfo, getHardwareProfile } from '../services/systemInfoService'
import type { RetrievalOptions } from '../../shared/types'

function isString(v: unknown): v is string {
  return typeof v === 'string'
}

function isNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

export function registerIpcHandlers(): void {
  ipcMain.handle('ping', () => 'pong')

  ipcMain.on('chat:resize', (_event, args: unknown) => {
    const { height } = (args ?? {}) as { height?: unknown }
    if (!isNumber(height)) return
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
      args: unknown,
    ) => {
      const { message } = (args ?? {}) as { message?: unknown }
      if (!isString(message) || message.trim().length === 0) return null
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

  ipcMain.handle('ollama:pull-model', async (event, args: unknown) => {
    const { name } = (args ?? {}) as { name?: unknown }
    if (!isString(name) || name.trim().length === 0) {
      return { success: false, error: 'Invalid model name' }
    }
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

  ipcMain.handle('ollama:delete-model', async (_event, args: unknown) => {
    const { name } = (args ?? {}) as { name?: unknown }
    if (!isString(name) || name.trim().length === 0) {
      return { success: false, error: 'Invalid model name' }
    }
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

  // ── System info ─────────────────────────────────────────────────

  ipcMain.handle('system:info', async () => {
    return getSystemInfo()
  })

  ipcMain.handle('system:hardware-profile', async () => {
    const info = await getSystemInfo()
    return getHardwareProfile(info)
  })

  // ── Settings ────────────────────────────────────────────────────

  ipcMain.handle('settings:get', () => {
    return getSettings()
  })

  ipcMain.handle('settings:update', (_event, partial: unknown) => {
    if (!partial || typeof partial !== 'object') return getSettings()

    const updated = updateSettings(partial as Partial<import('../../shared/types').AppSettings>)

    if ('startOnLogin' in (partial as Record<string, unknown>)) {
      setAutoStart(updated.startOnLogin)
    }

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
    async (_event, args: unknown) => {
      const { query, options } = (args ?? {}) as { query?: unknown; options?: RetrievalOptions }
      if (!isString(query)) return { error: 'Invalid query' }
      try {
        const docs = await retrieveRelevantDocuments(query, options)
        return docs.map((d) => ({ ...d, vector: undefined }))
      } catch (err) {
        return { error: err instanceof Error ? err.message : 'Search failed' }
      }
    },
  )

  ipcMain.handle('db:get-by-type', async (_event, args: unknown) => {
    const { type } = (args ?? {}) as { type?: unknown }
    if (!isString(type)) return { error: 'Invalid type' }
    try {
      const docs = await getDocumentsByType(type)
      return docs.map((d) => ({ ...d, vector: undefined }))
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Query failed' }
    }
  })
}
