import { app, BrowserWindow } from 'electron'
import { ElectronOllama } from 'electron-ollama'
import { getSettings } from './settingsService'
import type { OllamaSetupProgress } from '../../shared/types'

let eo: ElectronOllama | null = null

function broadcast(progress: OllamaSetupProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('ollama:setup-progress', progress)
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

export async function bootstrapOllama(customBasePath?: string): Promise<void> {
  const basePath = customBasePath || getSettings().ollamaPath || app.getPath('userData')
  eo = new ElectronOllama({
    basePath,
  })

  const settings = getSettings()
  if (settings.ollamaModelsPath) {
    process.env.OLLAMA_MODELS = settings.ollamaModelsPath
  }

  try {
    if (await eo.isRunning()) {
      console.log('[Lore] Ollama already running, skipping bootstrap')
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
        console.log('[Ollama]', message)
      },
    })

    console.log('[Lore] Ollama started via electron-ollama')
    broadcast({ phase: 'ready', percent: 100, message: 'AI engine is ready' })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to start AI engine'
    console.error('[Lore] Ollama bootstrap failed:', message)
    broadcast({ phase: 'error', percent: 0, message })
  }
}

export function stopOllama(): void {
  try {
    eo?.getServer()?.stop()
    console.log('[Lore] Ollama server stopped')
  } catch {
    // Ignore shutdown errors
  }
}
