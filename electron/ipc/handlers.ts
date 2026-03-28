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
  listModels,
  pullModel,
  abortPull,
  deleteModel,
} from '../services/ollamaService'
import { bootstrapOllama, restartOllamaWithNewModelsPath } from '../services/ollamaBootstrap'
import { getStats, resetTable } from '../services/lanceService'
import { retrieveRelevantDocuments } from '../services/documentPipeline'
import { getDocumentsByType } from '../services/lanceService'
import { processUserInput, clearConversation } from '../services/agentService'
import { getSystemInfo, getHardwareProfile } from '../services/systemInfoService'
import {
  fetchLatestVersion,
  getLastUpdatePromptShownAt,
  setLastUpdatePromptShownAt,
} from '../services/updateCheckService'
import {
  syncVault,
  syncAllVaults,
  getSyncStatus,
  getAllSyncStatuses,
  listTemplates,
  startWatcher,
  stopWatcher,
  removeVaultData,
} from '../services/obsidianService'
import { createObsidianNote } from '../services/obsidianNoteWriter'
import { getAllTags, getTagCount, buildRegistry as buildTagRegistry } from '../services/tagRegistry'
import { v4 as uuidv4 } from 'uuid'
import type {
  RetrievalOptions,
  PullProgress,
  AppSettings,
  DisplayInfo,
  ObsidianVaultConfig,
} from '../../shared/types'

const activePulls = new Map<string, PullProgress>()

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
            case 'retrieved':
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
          const updated = updateSettings(settingsUpdate)
          broadcastToAll('settings:changed', updated)
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
        updated.embeddingModel !== prev.embeddingModel &&
        prev.embeddingModel !== '') {
      resetTable().catch(err => {
        logger.error({ err }, '[Lore] Failed to reset database after embedding model change')
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

  // ── Obsidian integration ───────────────────────────────────────

  ipcMain.handle('obsidian:pick-vault-folder', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory'],
      title: 'Select Obsidian Vault Folder',
    })
    if (result.canceled) return null
    return result.filePaths[0]
  })

  ipcMain.handle('obsidian:add-vault', async (_event, args: unknown) => {
    const { name, vaultPath, templateFolder, noteDestination } = (args ?? {}) as {
      name?: string
      vaultPath?: string
      templateFolder?: string
      noteDestination?: string
    }
    if (!isString(vaultPath) || vaultPath.trim().length === 0) {
      return { success: false, error: 'Invalid vault path' }
    }

    const vaultConfig: ObsidianVaultConfig = {
      id: uuidv4(),
      name: isString(name) && name.trim() ? name.trim() : 'My Vault',
      vaultPath: vaultPath.trim(),
      templateFolder: isString(templateFolder) ? templateFolder.trim() : '',
      noteDestination: isString(noteDestination) ? noteDestination.trim() : '',
      enabled: true,
      lastSyncedAt: null,
    }

    const settings = getSettings()
    const updatedVaults = [...settings.obsidianVaults, vaultConfig]
    const updated = updateSettings({ obsidianVaults: updatedVaults })

    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('settings:changed', updated)
    }

    // Start watcher and trigger initial sync in background
    startWatcher(vaultConfig)
    syncVault(vaultConfig, (status) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('obsidian:sync-progress', status)
      }
    }).then((status) => {
      if (status.phase === 'done') {
        const latestSettings = getSettings()
        const vaultIndex = latestSettings.obsidianVaults.findIndex(v => v.id === vaultConfig.id)
        if (vaultIndex >= 0) {
          const vaults = [...latestSettings.obsidianVaults]
          vaults[vaultIndex] = { ...vaults[vaultIndex], lastSyncedAt: new Date().toISOString() }
          updateSettings({ obsidianVaults: vaults })
        }
      }
    }).catch(err => {
      logger.error({ err }, '[Obsidian] Initial sync failed')
    })

    return { success: true, vault: vaultConfig }
  })

  ipcMain.handle('obsidian:remove-vault', async (_event, args: unknown) => {
    const { vaultId } = (args ?? {}) as { vaultId?: string }
    if (!isString(vaultId)) return { success: false, error: 'Invalid vault ID' }

    const settings = getSettings()
    const updatedVaults = settings.obsidianVaults.filter(v => v.id !== vaultId)
    const updated = updateSettings({ obsidianVaults: updatedVaults })

    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('settings:changed', updated)
    }

    await removeVaultData(vaultId)
    return { success: true }
  })

  ipcMain.handle('obsidian:update-vault', async (_event, args: unknown) => {
    const { vaultId, updates } = (args ?? {}) as {
      vaultId?: string
      updates?: Partial<ObsidianVaultConfig>
    }
    if (!isString(vaultId) || !updates) return { success: false, error: 'Invalid arguments' }

    const settings = getSettings()
    const vaultIndex = settings.obsidianVaults.findIndex(v => v.id === vaultId)
    if (vaultIndex < 0) return { success: false, error: 'Vault not found' }

    const vaults = [...settings.obsidianVaults]
    vaults[vaultIndex] = { ...vaults[vaultIndex], ...updates, id: vaultId }
    const updated = updateSettings({ obsidianVaults: vaults })

    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('settings:changed', updated)
    }

    // Restart watcher if config changed
    if (vaults[vaultIndex].enabled) {
      startWatcher(vaults[vaultIndex])
    } else {
      stopWatcher(vaultId)
    }

    return { success: true }
  })

  ipcMain.handle('obsidian:sync-vault', async (_event, args: unknown) => {
    const { vaultId } = (args ?? {}) as { vaultId?: string }
    if (!isString(vaultId)) return { success: false, error: 'Invalid vault ID' }

    const settings = getSettings()
    const config = settings.obsidianVaults.find(v => v.id === vaultId)
    if (!config) return { success: false, error: 'Vault not found' }

    syncVault(config, (status) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('obsidian:sync-progress', status)
      }
    }).then((status) => {
      if (status.phase === 'done') {
        const latestSettings = getSettings()
        const idx = latestSettings.obsidianVaults.findIndex(v => v.id === vaultId)
        if (idx >= 0) {
          const vaults = [...latestSettings.obsidianVaults]
          vaults[idx] = { ...vaults[idx], lastSyncedAt: new Date().toISOString() }
          const updatedSettings = updateSettings({ obsidianVaults: vaults })
          for (const win of BrowserWindow.getAllWindows()) {
            win.webContents.send('settings:changed', updatedSettings)
          }
        }
      }
    }).catch(err => {
      logger.error({ err, vaultId }, '[Obsidian] Sync failed')
    })

    return { success: true }
  })

  ipcMain.handle('obsidian:wipe-and-resync', async (_event, args: unknown) => {
    const { vaultId } = (args ?? {}) as { vaultId?: string }
    if (!isString(vaultId)) return { success: false, error: 'Invalid vault ID' }

    const settings = getSettings()
    const config = settings.obsidianVaults.find(v => v.id === vaultId)
    if (!config) return { success: false, error: 'Vault not found' }

    try {
      await removeVaultData(vaultId)
    } catch (err) {
      logger.error({ err, vaultId }, '[Obsidian] Failed to wipe vault data before resync')
      return { success: false, error: 'Failed to wipe data' }
    }

    syncVault(config, (status) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('obsidian:sync-progress', status)
      }
    }).then((status) => {
      if (status.phase === 'done') {
        const latestSettings = getSettings()
        const idx = latestSettings.obsidianVaults.findIndex(v => v.id === vaultId)
        if (idx >= 0) {
          const vaults = [...latestSettings.obsidianVaults]
          vaults[idx] = { ...vaults[idx], lastSyncedAt: new Date().toISOString() }
          const updatedSettings = updateSettings({ obsidianVaults: vaults })
          for (const win of BrowserWindow.getAllWindows()) {
            win.webContents.send('settings:changed', updatedSettings)
          }
        }
      }
    }).catch(err => {
      logger.error({ err, vaultId }, '[Obsidian] Sync failed after wipe')
    })

    return { success: true }
  })

  ipcMain.handle('obsidian:sync-all', async () => {
    const settings = getSettings()
    syncAllVaults(settings.obsidianVaults, (status) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('obsidian:sync-progress', status)
      }
    }).catch(err => {
      logger.error({ err }, '[Obsidian] Sync all failed')
    })
    return { success: true }
  })

  ipcMain.handle('obsidian:sync-status', () => {
    return getAllSyncStatuses()
  })

  ipcMain.handle('obsidian:list-templates', (_event, args: unknown) => {
    const { vaultId } = (args ?? {}) as { vaultId?: string }
    if (!isString(vaultId)) return []

    const settings = getSettings()
    const config = settings.obsidianVaults.find(v => v.id === vaultId)
    if (!config) return []

    return listTemplates(config)
  })

  ipcMain.handle('obsidian:create-note', async (_event, args: unknown) => {
    const { vaultId, userIntent, templateName } = (args ?? {}) as {
      vaultId?: string
      userIntent?: string
      templateName?: string
    }
    if (!isString(vaultId) || !isString(userIntent)) {
      return { success: false, error: 'Invalid arguments' }
    }

    const settings = getSettings()
    const config = settings.obsidianVaults.find(v => v.id === vaultId)
    if (!config) return { success: false, error: 'Vault not found' }

    try {
      const result = await createObsidianNote(config, userIntent, templateName)
      return { success: true, ...result }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Note creation failed',
      }
    }
  })

  ipcMain.handle('obsidian:get-tags', () => {
    return { tags: getAllTags(), count: getTagCount() }
  })
}
