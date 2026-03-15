import { app } from 'electron'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { logger } from '../logger'

const VERSION_URL = 'https://raw.githubusercontent.com/ErezShahaf/Lore/main/version.json'
const FETCH_TIMEOUT_MS = 5000
const UPDATE_CHECK_FILENAME = 'update-check.json'

interface VersionResponse {
  version?: string
}

interface UpdateCheckState {
  lastPromptShownAt: number
}

function getUpdateCheckPath(): string {
  return join(app.getPath('userData'), UPDATE_CHECK_FILENAME)
}

export async function fetchLatestVersion(): Promise<string | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(VERSION_URL, { signal: controller.signal })
    clearTimeout(timeout)
    if (!response.ok) return null
    const body = (await response.json()) as VersionResponse
    const version = body?.version
    if (typeof version !== 'string' || version.trim().length === 0) return null
    return version.trim()
  } catch (err) {
    clearTimeout(timeout)
    logger.debug({ err }, '[Lore] Update check fetch failed')
    return null
  }
}

export async function getLastUpdatePromptShownAt(): Promise<number | null> {
  try {
    const path = getUpdateCheckPath()
    const raw = await readFile(path, 'utf-8')
    const data = JSON.parse(raw) as UpdateCheckState
    const at = data?.lastPromptShownAt
    if (typeof at !== 'number' || !Number.isFinite(at)) return null
    return at
  } catch {
    return null
  }
}

export async function setLastUpdatePromptShownAt(): Promise<void> {
  try {
    const userData = app.getPath('userData')
    await mkdir(userData, { recursive: true })
    const path = getUpdateCheckPath()
    const data: UpdateCheckState = { lastPromptShownAt: Date.now() }
    await writeFile(path, JSON.stringify(data), 'utf-8')
  } catch (err) {
    logger.warn({ err }, '[Lore] Failed to persist update prompt timestamp')
  }
}
