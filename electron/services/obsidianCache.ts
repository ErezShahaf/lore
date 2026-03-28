import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { logger } from '../logger'

export interface CacheEntry {
  mtimeMs: number
  size: number
  hash: string
}

export type VaultCache = Record<string, CacheEntry>

// App-wide cache state in memory
// Map of vaultId -> Record<filePath, CacheEntry>
let cacheState: Record<string, VaultCache> = {}
let cacheLoaded = false

function getCacheFilePath(): string {
  return join(app.getPath('userData'), 'obsidian-cache.json')
}

function ensureCacheLoaded(): void {
  if (!cacheLoaded) loadCache()
}

export function loadCache(): void {
  if (cacheLoaded) return

  const path = getCacheFilePath()
  if (existsSync(path)) {
    try {
      const data = readFileSync(path, 'utf-8')
      const parsed = JSON.parse(data)
      cacheState = parsed && typeof parsed === 'object' ? parsed as Record<string, VaultCache> : {}
    } catch (err) {
      logger.error({ err, path }, '[ObsidianCache] Failed to load cache from disk')
      cacheState = {}
    }
  } else {
    cacheState = {}
  }
  cacheLoaded = true
}

export function saveCache(): void {
  ensureCacheLoaded()
  const path = getCacheFilePath()
  try {
    writeFileSync(path, JSON.stringify(cacheState, null, 2), 'utf-8')
  } catch (err) {
    logger.error({ err, path }, '[ObsidianCache] Failed to save cache to disk')
  }
}

export function getVaultCache(vaultId: string): VaultCache {
  ensureCacheLoaded()
  if (!cacheState[vaultId]) {
    cacheState[vaultId] = {}
  }
  return cacheState[vaultId]
}

export function updateFileCache(vaultId: string, filePath: string, entry: CacheEntry): void {
  ensureCacheLoaded()
  if (!cacheState[vaultId]) {
    cacheState[vaultId] = {}
  }
  cacheState[vaultId][filePath] = entry
}

export function removeFileCache(vaultId: string, filePath: string): void {
  ensureCacheLoaded()
  if (cacheState[vaultId]) {
    delete cacheState[vaultId][filePath]
  }
}

export function removeVaultCache(vaultId: string): void {
  ensureCacheLoaded()
  delete cacheState[vaultId]
  saveCache()
}
