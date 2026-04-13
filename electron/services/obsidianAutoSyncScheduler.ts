import { logger } from '../logger'
import { getSettings } from './settingsService'
import { syncAllVaults } from './obsidianService'
import type { AppSettings } from '../../shared/types'

let autoSyncTimer: ReturnType<typeof setInterval> | null = null
let autoSyncInProgress = false

function clearAutoSyncTimer(): void {
  if (autoSyncTimer) {
    clearInterval(autoSyncTimer)
    autoSyncTimer = null
  }
}

function resolveIntervalMs(settings: AppSettings): number {
  const rawMinutes = settings.obsidianSyncIntervalMinutes
  const normalizedMinutes = Number.isFinite(rawMinutes)
    ? Math.max(1, Math.floor(rawMinutes))
    : 15

  return normalizedMinutes * 60_000
}

async function runScheduledAutoSync(): Promise<void> {
  if (autoSyncInProgress) {
    return
  }

  const settings = getSettings()
  if (!settings.obsidianAutoSync) {
    return
  }

  const enabledVaults = settings.obsidianVaults.filter((vault) => vault.enabled)
  if (enabledVaults.length === 0) {
    return
  }

  autoSyncInProgress = true
  try {
    await syncAllVaults(enabledVaults)
  } catch (err) {
    logger.error({ err }, '[ObsidianAutoSync] Scheduled sync failed')
  } finally {
    autoSyncInProgress = false
  }
}

export function startObsidianAutoSyncScheduler(settings: AppSettings = getSettings()): void {
  clearAutoSyncTimer()

  if (!settings.obsidianAutoSync) {
    logger.debug('[ObsidianAutoSync] Scheduler disabled by settings')
    return
  }

  const enabledVaultCount = settings.obsidianVaults.filter((vault) => vault.enabled).length
  const intervalMs = resolveIntervalMs(settings)
  autoSyncTimer = setInterval(() => {
    void runScheduledAutoSync()
  }, intervalMs)

  logger.info(
    {
      intervalMinutes: intervalMs / 60_000,
      enabledVaultCount,
    },
    '[ObsidianAutoSync] Scheduler started',
  )
}

export function refreshObsidianAutoSyncScheduler(
  previous: AppSettings,
  next: AppSettings,
): void {
  const autoSyncChanged = previous.obsidianAutoSync !== next.obsidianAutoSync
  const intervalChanged = previous.obsidianSyncIntervalMinutes !== next.obsidianSyncIntervalMinutes

  if (!autoSyncChanged && !intervalChanged) {
    return
  }

  startObsidianAutoSyncScheduler(next)
}

export function stopObsidianAutoSyncScheduler(): void {
  clearAutoSyncTimer()
  autoSyncInProgress = false
}
