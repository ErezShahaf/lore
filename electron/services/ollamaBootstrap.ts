import { execSync } from 'child_process'
import { app, BrowserWindow } from 'electron'
import { logger } from '../logger'
import { join } from 'path'
import { ElectronOllama } from 'electron-ollama'
import { getSettings } from './settingsService'
import type { OllamaSetupProgress } from '../../shared/types'

let eo: ElectronOllama | null = null


function getServerPid(server: unknown): number | undefined {
  if (server === null || typeof server !== 'object') return undefined
  const obj = server as Record<string, unknown>
  const proc = obj.process ?? obj['process']
  if (proc !== null && typeof proc === 'object' && 'pid' in proc) {
    const pid = (proc as { pid: number }).pid
    if (typeof pid !== 'number') return undefined
    if (pid === process.pid) return undefined
    return pid
  }
  return undefined
}

function tryKillProcessTreeWindows(pid: number): void {
  if (process.platform !== 'win32') return
  if (pid === process.pid) return
  try {
    execSync(`cmd /c "taskkill /F /PID ${pid} /T 2>NUL"`, {
      stdio: 'ignore',
      windowsHide: true,
    })
    logger.info({ pid }, '[Lore] Killed Ollama process tree on Windows')
  } catch {
    // Process may already be dead or not found; exit code is non-zero
  }
}

function broadcast(progress: OllamaSetupProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('ollama:setup-progress', progress)
  }
}

export function getDefaultOllamaModelsPath(): string {
  return join(app.getPath('home'), '.ollama', 'models')
}

function applyOllamaEnv(): void {
  const settings = getSettings()
  process.env.OLLAMA_MODELS = settings.ollamaModelsPath || getDefaultOllamaModelsPath()
  process.env.OLLAMA_MAX_LOADED_MODELS = '2'
}

async function isOllamaRespondingOnConfiguredHost(): Promise<boolean> {
  const host = getSettings().ollamaHost || 'http://127.0.0.1:11434'
  try {
    const res = await fetch(`${host}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function isOllamaSetupNeeded(): Promise<boolean> {
  const settings = getSettings()
  if (settings.ollamaSetupComplete) return false

  const host = settings.ollamaHost || 'http://127.0.0.1:11434'
  try {
    const res = await fetch(`${host}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    })
    return !res.ok
  } catch {
    return true
  }
}

function skipBecauseAlreadyRunning(): void {
  logger.info(
    '[Lore] Ollama already running on configured host — not starting another instance. ' +
    'On quit we will leave it running.',
  )
  broadcast({ phase: 'ready', percent: 100, message: 'Ollama is ready' })
}

export async function bootstrapOllama(customBasePath?: string): Promise<void> {
  const basePath = customBasePath || getSettings().ollamaPath || app.getPath('userData')
  eo = new ElectronOllama({
    basePath,
  })

  applyOllamaEnv()

  try {
    if (await isOllamaRespondingOnConfiguredHost()) {
      skipBecauseAlreadyRunning()
      return
    }

    if (await eo.isRunning()) {
      logger.warn(
        '[Lore] Ollama already running — OLLAMA_MAX_LOADED_MODELS and other env vars will not apply to the external instance. ' +
        'If models keep reloading, restart Ollama so it picks up the app\'s environment.',
      )
      broadcast({ phase: 'ready', percent: 100, message: 'Ollama is ready' })
      return
    }

    broadcast({ phase: 'downloading', percent: 0, message: 'Preparing AI engine...' })

    const metadata = await eo.getMetadata('latest')

    if (await eo.isDownloaded(metadata.version)) {
      broadcast({ phase: 'starting', percent: 100, message: 'Starting AI engine...' })
    }

    await eo.serve(metadata.version, {
      downloadLog: (percent, message) => {
        broadcast({ phase: 'downloading', percent, message })
      },
      serverLog: (message) => {
        const normalizedMessage = message.trim()
        if (normalizedMessage.length === 0) {
          return
        }
        // Avoid flooding app logs with Ollama internal server output.
        // Keep only server-side warning/error signals.
        const isWarningOrErrorLine =
          normalizedMessage.includes(' level=WARN ') || normalizedMessage.includes(' level=ERROR ')
        if (!isWarningOrErrorLine) {
          return
        }
        logger.warn({ message: normalizedMessage }, '[Ollama]')
      },
    })

    const server = eo.getServer()
    const pid = server ? getServerPid(server) : undefined
    if (pid !== undefined) {
      logger.info({ pid }, '[Lore] Ollama started via electron-ollama (will stop on quit)')
    }
    broadcast({ phase: 'ready', percent: 100, message: 'AI engine is ready' })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to start AI engine'
    logger.error({ message }, '[Lore] Ollama bootstrap failed')
    broadcast({ phase: 'error', percent: 0, message })
  }
}

export async function stopOllama(): Promise<void> {
  const server = eo?.getServer()
  if (!server) {
    return
  }
  const pid = getServerPid(server)
  if (pid !== undefined) {
    tryKillProcessTreeWindows(pid)
  }
  try {
    await server.stop()
    logger.info('[Lore] Stopped Ollama instance we started')
  } catch {
    // Ignore shutdown errors
  }
}

export async function restartOllamaWithNewModelsPath(): Promise<void> {
  logger.info('[Lore] Restarting Ollama with updated models path...')
  await stopOllama()
  await new Promise(resolve => setTimeout(resolve, 500))
  await bootstrapOllama()
}
