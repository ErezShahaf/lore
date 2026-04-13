import { app, BrowserWindow } from 'electron'
import { logger } from './logger'
import { join } from 'path'
import { appendFileSync } from 'fs'
import { createChatWindow, showChatWindow, getChatWindow } from './windows/chatWindow'
import { createSetupWindow } from './windows/setupWindow'
import { createTray, destroyTray } from './tray/trayManager'
import { registerShortcuts, unregisterShortcuts } from './shortcuts'
import { registerIpcHandlers } from './ipc/handlers'
import { getSettings, updateSettings } from './services/settingsService'
import { startHealthCheck, stopHealthCheck, preloadModels } from './services/ollamaService'
import { bootstrapOllama, stopOllama, isOllamaSetupNeeded } from './services/ollamaBootstrap'
import { initialize as initLanceDB, cleanupOldDeleted, compactTable } from './services/lanceService'
import { applyAutoStart } from './services/autoStartService'
import { syncAllVaults, startWatcher, stopAllWatchers } from './services/obsidianService'
import {
  startObsidianAutoSyncScheduler,
  stopObsidianAutoSyncScheduler,
} from './services/obsidianAutoSyncScheduler'
import { buildRegistry as buildTagRegistry } from './services/tagRegistry'

function logErrorToFile(label: string, err: unknown): void {
  try {
    const logPath = join(app.getPath('userData'), 'error.log')
    const timestamp = new Date().toISOString()
    const message = err instanceof Error ? err.stack ?? err.message : String(err)
    appendFileSync(logPath, `[${timestamp}] ${label}: ${message}\n`, 'utf-8')
  } catch {
    // Avoid infinite loops if logging itself fails
  }
}

process.on('uncaughtException', (err) => {
  logger.error({ err }, '[Lore] Uncaught exception')
  logErrorToFile('uncaughtException', err)
})

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, '[Lore] Unhandled rejection')
  logErrorToFile('unhandledRejection', reason)
})

function onSignal(): void {
  stopHealthCheck()
  const exitAfterCleanup = (code: number) => {
    process.exit(code)
  }
  const timeout = setTimeout(() => exitAfterCleanup(1), 15_000)
  stopOllama()
    .then(() => {
      clearTimeout(timeout)
      exitAfterCleanup(0)
    })
    .catch((err) => {
      clearTimeout(timeout)
      logger.error({ err }, '[Lore] Error during signal cleanup')
      exitAfterCleanup(1)
    })
}

process.prependOnceListener('SIGINT', onSignal)
process.prependOnceListener('SIGTERM', onSignal)

process.env.DIST_ELECTRON = join(__dirname)
process.env.DIST = join(process.env.DIST_ELECTRON, '../dist')
process.env.VITE_PUBLIC = process.env.VITE_DEV_SERVER_URL
  ? join(process.env.DIST_ELECTRON, '../public')
  : process.env.DIST

const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showChatWindow()
  })

  app.whenReady().then(async () => {
    registerIpcHandlers()

    try {
      await initLanceDB()
      logger.info('[Lore] LanceDB initialized')

      cleanupOldDeleted(30).then((count) => {
        if (count > 0) logger.info({ count }, '[Lore] Cleaned up old deleted documents')
      }).catch(() => {})

      compactTable().catch(() => {})
    } catch (err) {
      logger.error({ err }, '[Lore] Failed to initialize LanceDB')
    }

    const settings = getSettings()

    createTray()
    registerShortcuts()
    applyAutoStart()

    startHealthCheck((status) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('ollama:status-changed', status)
      }
    })

    const needsSetup = await isOllamaSetupNeeded()

    if (needsSetup) {
      createSetupWindow()
    } else {
      if (!settings.ollamaSetupComplete) {
        updateSettings({ ollamaSetupComplete: true })
      }

      createChatWindow()

      bootstrapOllama()
        .then(() => preloadModels())
        .catch((err) => {
          logger.error({ err }, '[Lore] Ollama bootstrap error')
        })

      // ── Obsidian integration bootstrap ──────────────────────────
      const obsidianVaults = settings.obsidianVaults ?? []
      const enabledVaults = obsidianVaults.filter(v => v.enabled)

      if (enabledVaults.length > 0) {
        // Build tag registry from existing data
        buildTagRegistry().catch((err) => {
          logger.error({ err }, '[Lore] Failed to build tag registry')
        })

        // Start file watchers for enabled vaults
        for (const vault of enabledVaults) {
          startWatcher(vault)
        }

        // Run initial sync if auto-sync is enabled
        if (settings.obsidianAutoSync) {
          syncAllVaults(enabledVaults).catch((err) => {
            logger.error({ err }, '[Lore] Obsidian auto-sync failed')
          })
        }

        // Start periodic auto-sync scheduler (respects obsidianAutoSync + interval settings)
        startObsidianAutoSyncScheduler(settings)

        logger.info({ vaultCount: enabledVaults.length }, '[Lore] Obsidian integration started')
      } else {
        // Still build tag registry for Lore-native tags
        buildTagRegistry().catch(() => {})

        // Scheduler is still started so it can react if vaults/settings change later
        startObsidianAutoSyncScheduler(settings)
      }
    }
  })

  app.on('window-all-closed', () => {
    // Keep running in tray
  })

  app.on('activate', () => {
    if (getChatWindow()) {
      showChatWindow()
    } else {
      createChatWindow()
    }
  })

  let isQuitting = false
  app.on('will-quit', (event) => {
    if (isQuitting) return
    event.preventDefault()
    isQuitting = true
    unregisterShortcuts()
    destroyTray()
    stopHealthCheck()
    stopObsidianAutoSyncScheduler()
    stopAllWatchers()
    stopOllama()
      .then(() => app.quit())
      .catch((err) => {
        logger.error({ err }, '[Lore] Error during quit cleanup')
        app.quit()
      })
  })

  app.on('before-quit', () => {
    const win = getChatWindow()
    if (win) win.destroy()
  })
}
