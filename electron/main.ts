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
import { startEvalServer, stopEvalServer } from './services/evalServer'
import { configureRuntimeProfile, isEvalRuntimeProfile } from './services/runtimeProfileService'
import type { AppSettings } from '../shared/types'

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
  stopEvalServer()
    .then(async () => {
      if (!isEvalMode) {
        await stopOllama()
      }
    })
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

const runtimeProfileState = configureRuntimeProfile()
const isEvalMode = isEvalRuntimeProfile()

function getEnvironmentSettingsOverrides(): Partial<AppSettings> {
  const settingsUpdate: Partial<AppSettings> = {}

  if (typeof process.env.LORE_SELECTED_MODEL === 'string') {
    settingsUpdate.selectedModel = process.env.LORE_SELECTED_MODEL
  }

  if (typeof process.env.LORE_EMBEDDING_MODEL === 'string') {
    settingsUpdate.embeddingModel = process.env.LORE_EMBEDDING_MODEL
  }

  if (typeof process.env.LORE_OLLAMA_HOST === 'string') {
    settingsUpdate.ollamaHost = process.env.LORE_OLLAMA_HOST
  }

  if (isEvalMode) {
    settingsUpdate.ollamaSetupComplete = true
  }

  return settingsUpdate
}

const gotLock = isEvalMode ? true : app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  if (!isEvalMode) {
    app.on('second-instance', () => {
      showChatWindow()
    })
  }

  app.whenReady().then(async () => {
    if (!isEvalMode) {
      registerIpcHandlers()
    }

    const environmentSettingsOverrides = getEnvironmentSettingsOverrides()
    if (Object.keys(environmentSettingsOverrides).length > 0) {
      updateSettings(environmentSettingsOverrides)
    }

    try {
      await initLanceDB()
      logger.info({
        profile: runtimeProfileState.profile,
        userDataPath: runtimeProfileState.userDataPath,
      }, '[Lore] LanceDB initialized')

      cleanupOldDeleted(30).then((count) => {
        if (count > 0) logger.info({ count }, '[Lore] Cleaned up old deleted documents')
      }).catch(() => {})

      compactTable().catch(() => {})
    } catch (err) {
      logger.error({ err }, '[Lore] Failed to initialize LanceDB')
    }

    if (isEvalMode) {
      try {
        await startEvalServer()
      } catch (err) {
        logger.error({ err }, '[Lore] Failed to start eval server')
        app.quit()
      }
      return
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
    }
  })

  app.on('window-all-closed', () => {
    // Keep running in tray
  })

  app.on('activate', () => {
    if (isEvalMode) {
      return
    }

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
    if (!isEvalMode) {
      unregisterShortcuts()
      destroyTray()
    }
    stopHealthCheck()
    stopEvalServer()
      .then(async () => {
        if (!isEvalMode) {
          await stopOllama()
        }
      })
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
