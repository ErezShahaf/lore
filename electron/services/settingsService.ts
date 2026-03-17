import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import type { AppSettings } from '../../shared/types'

const DEFAULTS: AppSettings = {
  shortcut: 'CommandOrControl+Shift+Space',
  startOnLogin: true,
  hideOnBlur: true,
  preferredDisplayId: null,
  selectedModel: '',
  embeddingModel: '',
  ollamaHost: 'http://127.0.0.1:11434',
  ollamaPath: '',
  ollamaModelsPath: '',
  ollamaSetupComplete: false,
}

function getSettingsPath(): string {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'settings.json')
}

let cached: AppSettings | null = null

export function getSettings(): AppSettings {
  if (cached) return cached

  const path = getSettingsPath()
  if (!existsSync(path)) {
    cached = { ...DEFAULTS }
    writeFileSync(path, JSON.stringify(cached, null, 2), 'utf-8')
    return cached
  }

  try {
    const raw = readFileSync(path, 'utf-8')
    cached = { ...DEFAULTS, ...JSON.parse(raw) }
    return cached!
  } catch {
    cached = { ...DEFAULTS }
    return cached
  }
}

export function updateSettings(partial: Partial<AppSettings>): AppSettings {
  const current = getSettings()
  const updated = { ...current, ...partial }
  cached = updated
  writeFileSync(getSettingsPath(), JSON.stringify(updated, null, 2), 'utf-8')
  return updated
}
