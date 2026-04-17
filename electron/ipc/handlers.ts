import { ipcMain, BrowserWindow, dialog, app, shell } from 'electron'
import { logger } from '../logger'
import {
  resizeChatWindow,
  hideChatWindow,
  createChatWindow,
  showChatWindow,
  repositionChatWindow,
} from '../windows/chatWindow'
import { createSettingsWindow } from '../windows/settingsWindow'
import { closeSetupWindow } from '../windows/setupWindow'
import { getSettings, updateSettings } from '../services/settingsService'
import { listDisplays } from '../services/displayService'
import { setAutoStart } from '../services/autoStartService'
import {
  checkConnection,
  chatModelInferenceCompletedEmitter,
  getLikelyChatModelWasEvicted,
  listModels,
  pullModel,
  abortPull,
  deleteModel,
} from '../services/ollamaService'
import { bootstrapOllama, restartOllamaWithNewModelsPath } from '../services/ollamaBootstrap'
import { getStats } from '../services/lanceService'
import { retrieveRelevantDocuments } from '../services/documentPipeline'
import { getDocumentsByType } from '../services/lanceService'
import {
  discardEmbeddingMigration,
  embeddingMigrationEvents,
  ensureDocumentsTableMatchesEmbeddingModel,
  getEmbeddingMigrationStatus,
  retryEmbeddingMigration,
} from '../services/embeddingTableSync'
import { processUserInput } from '../services/agentService'
import { getSystemInfo, getHardwareProfile } from '../services/systemInfoService'
import {
  fetchLatestVersion,
  getLastUpdatePromptShownAt,
  setLastUpdatePromptShownAt,
} from '../services/updateCheckService'
import type {
  RetrievalOptions,
  PullProgress,
  AppSettings,
  DisplayInfo,
  EmbeddingMigrationStatus,
} from '../../shared/types'

const activePulls = new Map<string, PullProgress>()

function isString(v: unknown): v is string {
  return typeof v === 'string'
}

function isNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function broadcastToAllWindows(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

export function registerIpcHandlers(): void {
  ipcMain.handle('ping', () => 'pong')

  // Forward migration state changes to all renderer windows so the chat UI
  // can render progress/error panels immediately and block input.
  embeddingMigrationEvents.on('status-changed', (status: EmbeddingMigrationStatus) => {
    broadcastToAllWindows('embedding-migration:status-changed', status)
  })

  ipcMain.on('chat:resize', (_event, args: unknown) => {
    const { height } = (args ?? {}) as { height?: unknown }
    if (!isNumber(height)) return
    resizeChatWindow(height)
  })

  ipcMain.on('chat:hide', () => {
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
      const normalizedUserMessage = message.trim()
      logger.info(
        {
          event: 'user_message',
          userMessage: normalizedUserMessage,
        },
        `\x1b[91m[USER SAID]\x1b[0m ${normalizedUserMessage}`,
      )
      const sender = event.sender

      const status = await checkConnection()
      if (!status.connected) {
        sender.send('chat:response-error', {
          error: 'Ollama is not running. Please start Ollama and try again.',
        })
        return null
      }

      sender.send('chat:likely-chat-model-evicted', {
        likely: getLikelyChatModelWasEvicted(),
      })

      const onChatModelInferenceCompleted = (): void => {
        sender.send('chat:model-inference-completed')
      }
      chatModelInferenceCompletedEmitter.once('inference-completed', onChatModelInferenceCompleted)

      try {
        const generator = processUserInput(normalizedUserMessage)

        for await (const agentEvent of generator) {
          switch (agentEvent.type) {
            case 'chunk':
              sender.send('chat:response-chunk', { chunk: agentEvent.content })
              break
            case 'thinking_chunk':
              sender.send('chat:thinking-chunk', { chunk: agentEvent.content })
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
            case 'retrieved':
            case 'read_retrieval_context':
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
        sender.send('chat:response-end')
      } finally {
        chatModelInferenceCompletedEmitter.off('inference-completed', onChatModelInferenceCompleted)
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

  ipcMain.handle('ollama:pull-model', async (_event, args: unknown) => {
    const { name, category } = (args ?? {}) as { name?: unknown; category?: unknown }
    if (!isString(name) || name.trim().length === 0) {
      return { success: false, error: 'Invalid model name' }
    }
    if (activePulls.has(name)) {
      return { success: false, error: 'Already downloading this model' }
    }

    activePulls.set(name, { status: 'Starting download...' })
    const broadcastToAll = (channel: string, payload: unknown) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(channel, payload)
      }
    }

    try {
      await pullModel(name, (progress) => {
        activePulls.set(name, progress)
        broadcastToAll('ollama:pull-progress', { model: name, ...progress })
      })
      activePulls.delete(name)

      const modelCategory = isString(category) ? category : null
      if (modelCategory) {
        const settings = getSettings()
        const settingsUpdate: Partial<AppSettings> = {}
        if (modelCategory === 'chat' && !settings.selectedModel) {
          settingsUpdate.selectedModel = name
        }
        if (modelCategory === 'embedding' && !settings.embeddingModel) {
          settingsUpdate.embeddingModel = name
        }
        if (Object.keys(settingsUpdate).length > 0) {
          const previousEmbeddingModel = settings.embeddingModel
          const updated = updateSettings(settingsUpdate)
          broadcastToAll('settings:changed', updated)

          // When a pull auto-assigns the embedding model, the settings:update
          // IPC flow is bypassed — run the same reconciliation here so the
          // LanceDB schema width matches the chosen model before any search.
          if (settingsUpdate.embeddingModel !== undefined) {
            ensureDocumentsTableMatchesEmbeddingModel({
              previousModelName: previousEmbeddingModel,
              newModelName: settingsUpdate.embeddingModel,
            }).catch((err) => {
              logger.error(
                { err },
                '[Lore] Embedding sync after pull auto-assign failed',
              )
            })
          }
        }
      }

      broadcastToAll('ollama:pull-complete', { model: name, success: true })
      return { success: true }
    } catch (err) {
      const wasTracked = activePulls.has(name)
      activePulls.delete(name)
      const error = err instanceof Error ? err.message : 'Pull failed'
      if (wasTracked) {
        broadcastToAll('ollama:pull-complete', { model: name, success: false, error })
      }
      return { success: false, error }
    }
  })

  ipcMain.handle('ollama:active-pulls', () => {
    const result: Record<string, PullProgress> = {}
    for (const [model, progress] of activePulls) {
      result[model] = progress
    }
    return result
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

  ipcMain.handle('ollama:abort-pull', (_event, args: unknown) => {
    const { name } = (args ?? {}) as { name?: unknown }
    if (!isString(name)) return { success: false }
    const aborted = abortPull(name)
    if (aborted) {
      activePulls.delete(name)
      const broadcast = (channel: string, payload: unknown) => {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send(channel, payload)
        }
      }
      broadcast('ollama:pull-complete', { model: name, success: false, error: 'Download cancelled' })
    }
    return { success: aborted }
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

  ipcMain.handle('settings:open', () => {
    createSettingsWindow()
  })

  ipcMain.handle('settings:get', () => {
    return getSettings()
  })

  ipcMain.handle('window:list-displays', (): DisplayInfo[] => {
    return listDisplays()
  })

  ipcMain.handle('settings:update', async (_event, partial: unknown) => {
    if (!partial || typeof partial !== 'object') return getSettings()

    const prev = getSettings()
    const updated = updateSettings(partial as Partial<AppSettings>)

    if ('startOnLogin' in (partial as Record<string, unknown>)) {
      setAutoStart(updated.startOnLogin)
    }

    if ('ollamaModelsPath' in (partial as Record<string, unknown>) &&
        updated.ollamaModelsPath !== prev.ollamaModelsPath) {
      restartOllamaWithNewModelsPath().catch(err => {
        logger.error({ err }, '[Lore] Failed to restart Ollama after models path change')
      })
    }

    if ('embeddingModel' in (partial as Record<string, unknown>) &&
        updated.embeddingModel !== prev.embeddingModel) {
      // Reconcile the LanceDB schema with the new embedding model. Previously
      // this was gated on `prev.embeddingModel !== ''` and also bluntly wiped
      // the table, which caused the 1024-dim query / 768-dim table mismatch
      // on first-model selection and silently destroyed user data otherwise.
      // The sync helper picks the right action: no-op, empty reset, or a
      // chunked re-embedding migration — and broadcasts progress.
      ensureDocumentsTableMatchesEmbeddingModel({
        previousModelName: prev.embeddingModel,
        newModelName: updated.embeddingModel,
      }).catch(err => {
        logger.error({ err }, '[Lore] Embedding sync after settings:update failed')
      })
    }

    if ('preferredDisplayId' in (partial as Record<string, unknown>) &&
        updated.preferredDisplayId !== prev.preferredDisplayId) {
      repositionChatWindow()
    }

    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('settings:changed', updated)
    }
    return updated
  })

  // ── Embedding migration ────────────────────────────────────────

  ipcMain.handle('embedding-migration:get-status', (): EmbeddingMigrationStatus => {
    return getEmbeddingMigrationStatus()
  })

  ipcMain.handle('embedding-migration:retry', async () => {
    try {
      await retryEmbeddingMigration()
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Retry failed' }
    }
  })

  ipcMain.handle('embedding-migration:discard', async () => {
    try {
      await discardEmbeddingMigration()
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Discard failed' }
    }
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

  // ── Ollama setup wizard ────────────────────────────────────────

  ipcMain.handle('setup:get-default-path', () => {
    return app.getPath('userData')
  })

  ipcMain.handle('setup:pick-folder', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory'],
      title: 'Choose Ollama install location',
    })
    if (result.canceled) return null
    return result.filePaths[0]
  })

  ipcMain.handle('setup:pick-models-folder', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory'],
      title: 'Choose where to store AI models',
    })
    if (result.canceled) return null
    return result.filePaths[0]
  })

  ipcMain.handle('setup:begin', async (_event, args: unknown) => {
    const { ollamaPath, ollamaModelsPath } = (args ?? {}) as { ollamaPath?: string; ollamaModelsPath?: string }
    const resolvedPath = isString(ollamaPath) && ollamaPath.length > 0
      ? ollamaPath
      : app.getPath('userData')

    const settingsUpdate: Partial<import('../../shared/types').AppSettings> = { ollamaPath: resolvedPath }
    if (isString(ollamaModelsPath) && ollamaModelsPath.length > 0) {
      settingsUpdate.ollamaModelsPath = ollamaModelsPath
    }
    updateSettings(settingsUpdate)

    bootstrapOllama(resolvedPath).catch((err) => {
      logger.error({ err }, '[Lore] Setup bootstrap failed')
    })

    return { success: true }
  })

  ipcMain.handle('setup:complete', () => {
    updateSettings({ ollamaSetupComplete: true })
    closeSetupWindow()

    const chatWindow = createChatWindow()

    chatWindow.once('ready-to-show', () => {
      showChatWindow()
    })
  })

  ipcMain.on('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })

  ipcMain.on('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  ipcMain.on('window:open-external', (_event, url: string) => {
    if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
      shell.openExternal(url)
    }
  })

  // ── Update check ───────────────────────────────────────────────

  ipcMain.handle('update:get-latest-version', async () => {
    const version = await fetchLatestVersion()
    return version !== null ? { version } : null
  })

  ipcMain.handle('update:get-last-prompt-shown', async () => {
    const at = await getLastUpdatePromptShownAt()
    return at
  })

  ipcMain.handle('update:set-last-prompt-shown', async () => {
    await setLastUpdatePromptShownAt()
  })
}
