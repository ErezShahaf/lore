import { readFileSync, readdirSync, statSync, watch, existsSync } from 'fs'
import { join, relative, extname, basename } from 'path'
import { logger } from '../logger'
import { embedText } from './embeddingService'
import { insertDocuments, getDocumentsByFilter, hardDeleteDocument } from './lanceService'
import { addTags, invalidate as invalidateTagRegistry } from './tagRegistry'
import {
  loadCache,
  getVaultCache,
  updateFileCache,
  removeFileCache,
  removeVaultCache,
  saveCache
} from './obsidianCache'
import { createHash } from 'crypto'
import { v4 as uuidv4 } from 'uuid'
import type {
  ObsidianVaultConfig,
  ObsidianSyncStatus,
  ObsidianTemplate,
  LoreDocument,
} from '../../shared/types'

// ── Constants ─────────────────────────────────────────────────

const CHUNK_TOKEN_LIMIT = 500
const CHUNK_OVERLAP_TOKENS = 100
const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---/
const TEMPLATE_FIELD_REGEX = /\{\{([^}]+)\}\}/g

// ── Watcher state ─────────────────────────────────────────────

const watchers = new Map<string, ReturnType<typeof watch>>()
const syncStatuses = new Map<string, ObsidianSyncStatus>()

// ── Public status API ─────────────────────────────────────────

export function getSyncStatus(vaultId: string): ObsidianSyncStatus | null {
  return syncStatuses.get(vaultId) ?? null
}

export function getAllSyncStatuses(): ObsidianSyncStatus[] {
  return [...syncStatuses.values()]
}

// ── Frontmatter parsing ───────────────────────────────────────

interface ParsedNote {
  frontmatter: Record<string, unknown>
  body: string
  rawContent: string
}

export function parseFrontmatter(content: string): ParsedNote {
  const match = content.match(FRONTMATTER_REGEX)

  if (!match) {
    return { frontmatter: {}, body: content.trim(), rawContent: content }
  }

  const yamlBlock = match[1]
  const body = content.slice(match[0].length).trim()
  const frontmatter: Record<string, unknown> = {}

  // Simple line-by-line YAML parser (handles key: value and key: [list])
  let currentKey = ''
  let currentList: string[] | null = null

  for (const line of yamlBlock.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    // List item under previous key
    if (trimmed.startsWith('- ') && currentList !== null) {
      currentList.push(trimmed.slice(2).trim().replace(/^["']|["']$/g, ''))
      continue
    }

    // Close previous list if we hit a new key
    if (currentList !== null) {
      frontmatter[currentKey] = currentList
      currentList = null
    }

    const colonIndex = trimmed.indexOf(':')
    if (colonIndex === -1) continue

    const key = trimmed.slice(0, colonIndex).trim()
    const rawValue = trimmed.slice(colonIndex + 1).trim()

    if (!rawValue) {
      // Possible list follows
      currentKey = key
      currentList = []
      continue
    }

    // Inline list: [a, b, c]
    if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
      const items = rawValue.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
      frontmatter[key] = items
    } else {
      frontmatter[key] = rawValue.replace(/^["']|["']$/g, '')
    }
  }

  // Close any trailing list
  if (currentList !== null) {
    frontmatter[currentKey] = currentList
  }

  return { frontmatter, body, rawContent: content }
}

// ── Tag extraction from frontmatter ───────────────────────────

export function extractTags(frontmatter: Record<string, unknown>): string[] {
  const tags: string[] = []
  const fmTags = frontmatter.tags

  if (Array.isArray(fmTags)) {
    for (const t of fmTags) {
      if (typeof t === 'string' && t.trim()) tags.push(t.trim())
    }
  } else if (typeof fmTags === 'string') {
    const parts = fmTags.split(',').map(s => s.trim()).filter(Boolean)
    tags.push(...parts)
  }

  return tags
}

// ── Chunking ──────────────────────────────────────────────────

export function chunkText(text: string, tokenLimit = CHUNK_TOKEN_LIMIT, overlap = CHUNK_OVERLAP_TOKENS): string[] {
  // Approximate tokens as words
  const words = text.split(/\s+/)
  if (words.length <= tokenLimit) return [text]

  const chunks: string[] = []
  let start = 0

  while (start < words.length) {
    const end = Math.min(start + tokenLimit, words.length)
    chunks.push(words.slice(start, end).join(' '))
    start += tokenLimit - overlap
    if (start >= words.length) break
  }

  return chunks
}

// ── File discovery ────────────────────────────────────────────

function discoverMarkdownFiles(
  directory: string,
  templateFolder?: string,
): string[] {
  const results: string[] = []

  function walk(dir: string): void {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }

    for (const entry of entries) {
      if (entry.startsWith('.')) continue

      const fullPath = join(dir, entry)

      try {
        const stat = statSync(fullPath)

        if (stat.isDirectory()) {
          // Skip template folder during indexing
          if (templateFolder) {
            const rel = relative(directory, fullPath)
            if (rel === templateFolder || rel.startsWith(templateFolder + '/')) {
              continue
            }
          }
          walk(fullPath)
        } else if (extname(entry) === '.md') {
          results.push(fullPath)
        }
      } catch {
        // Skip unreadable files
      }
    }
  }

  walk(directory)
  return results
}

// ── Delete existing docs for a vault ──────────────────────────

async function deleteVaultDocuments(vaultId: string): Promise<number> {
  const filter = `source = 'obsidian' AND metadata LIKE '%"vaultId":"${vaultId}"%'`
  const docs = await getDocumentsByFilter(filter)
  let deleted = 0

  for (const doc of docs) {
    await hardDeleteDocument(doc.id)
    deleted++
  }

  return deleted
}

// ── Delete docs for a specific file ───────────────────────────

async function deleteFileDocuments(vaultId: string, filePath: string): Promise<number> {
  const escapedPath = filePath.replace(/'/g, "''")
  const filter = `source = 'obsidian' AND metadata LIKE '%"vaultId":"${vaultId}"%' AND metadata LIKE '%"filePath":"${escapedPath}"%'`
  const docs = await getDocumentsByFilter(filter)
  let deleted = 0

  for (const doc of docs) {
    await hardDeleteDocument(doc.id)
    deleted++
  }

  return deleted
}

// ── Index a single file ───────────────────────────────────────

async function indexFile(
  config: ObsidianVaultConfig,
  filePath: string,
  providedContent?: string,
  providedStat?: import('fs').Stats,
): Promise<{ chunksCreated: number }> {
  let stat = providedStat
  if (!stat) {
    try {
      stat = statSync(filePath)
    } catch {
      return { chunksCreated: 0 }
    }
  }

  let rawContent = providedContent
  if (rawContent === undefined) {
    try {
      rawContent = readFileSync(filePath, 'utf-8')
    } catch {
      logger.warn({ filePath }, '[Obsidian] Cannot read file, skipping')
      return { chunksCreated: 0 }
    }
  }

  const { frontmatter, body } = parseFrontmatter(rawContent)
  if (!body.trim()) return { chunksCreated: 0 }

  const tags = extractTags(frontmatter)
  const fileName = basename(filePath, '.md')
  const relPath = relative(config.vaultPath, filePath)
  const now = new Date().toISOString()

  // Extract date from frontmatter or file stat
  let noteDate = ''
  if (typeof frontmatter.date === 'string') {
    noteDate = frontmatter.date
  } else if (typeof frontmatter.created === 'string') {
    noteDate = frontmatter.created
  } else {
    noteDate = stat.mtime.toISOString().split('T')[0]
  }

  const chunks = chunkText(body)
  const documents: LoreDocument[] = []

  for (let i = 0; i < chunks.length; i++) {
    // Prepend title for better embedding context
    const textToEmbed = `${fileName}: ${chunks[i]}`
    const vector = await embedText(textToEmbed)

    const metadata = JSON.stringify({
      vaultId: config.id,
      vaultName: config.name,
      filePath: relPath,
      fileName,
      chunkIndex: i,
      totalChunks: chunks.length,
      frontmatter,
    })

    documents.push({
      id: uuidv4(),
      content: chunks[i],
      vector,
      type: 'obsidian-note',
      createdAt: now,
      updatedAt: now,
      date: noteDate,
      tags: tags.join(','),
      source: 'obsidian',
      metadata,
      isDeleted: false,
    })
  }

  if (documents.length > 0) {
    await insertDocuments(documents)
    addTags(tags)
  }

  return { chunksCreated: documents.length }
}

// ── Sync a single vault ───────────────────────────────────────

export async function syncVault(
  config: ObsidianVaultConfig,
  onProgress?: (status: ObsidianSyncStatus) => void,
): Promise<ObsidianSyncStatus> {
  const status: ObsidianSyncStatus = {
    vaultId: config.id,
    vaultName: config.name,
    phase: 'scanning',
    filesProcessed: 0,
    totalFiles: 0,
    notesIndexed: 0,
    lastError: null,
  }

  syncStatuses.set(config.id, status)
  onProgress?.(status)

  try {
    if (!existsSync(config.vaultPath)) {
      throw new Error(`Vault path does not exist: ${config.vaultPath}`)
    }

    // Discover all markdown files (excluding template folder)
    const files = discoverMarkdownFiles(config.vaultPath, config.templateFolder || undefined)
    status.totalFiles = files.length

    logger.info(
      { vaultName: config.name, fileCount: files.length },
      '[Obsidian] Starting vault sync',
    )

    status.phase = 'embedding'
    onProgress?.(status)

    // Load state
    loadCache()
    const vaultCache = getVaultCache(config.id)
    const knownFilePaths = new Set(Object.keys(vaultCache))
    const seenFiles = new Set<string>()

    // Check for new or modified files
    for (const filePath of files) {
      const relPath = relative(config.vaultPath, filePath)
      seenFiles.add(relPath)
      
      let stat
      try {
        stat = statSync(filePath)
      } catch {
        continue
      }

      const cached = vaultCache[relPath]

      // Tier 1: Fast path checking mtimeMs and size
      if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        status.filesProcessed++
        onProgress?.(status)
        continue
      }

      // Tier 2: Reliable path, checking MD5 hash
      let rawContent: string
      try {
        rawContent = readFileSync(filePath, 'utf-8')
      } catch {
        continue
      }

      const fileHash = createHash('md5').update(rawContent).digest('hex')

      if (cached && cached.hash === fileHash) {
        // Content matches, just update the tier 1 metrics
        updateFileCache(config.id, relPath, { mtimeMs: stat.mtimeMs, size: stat.size, hash: fileHash })
        status.filesProcessed++
        onProgress?.(status)
        continue
      }

      // File is actually new or changed -> index
      try {
        if (cached) await deleteFileDocuments(config.id, relPath)
        
        const result = await indexFile(config, filePath, rawContent, stat)
        status.notesIndexed += result.chunksCreated
        updateFileCache(config.id, relPath, { mtimeMs: stat.mtimeMs, size: stat.size, hash: fileHash })
      } catch (err) {
        logger.warn({ err, filePath }, '[Obsidian] Failed to index file')
      }

      status.filesProcessed++
      onProgress?.(status)
    }

    // Check for deleted files (in cache but not seen on disk)
    let deletedCount = 0
    for (const relPath of knownFilePaths) {
      if (!seenFiles.has(relPath)) {
        await deleteFileDocuments(config.id, relPath)
        delete vaultCache[relPath]
        deletedCount++
      }
    }

    if (deletedCount > 0) {
      logger.debug({ deletedCount, vaultId: config.id }, '[Obsidian] Cleaned up deleted vault documents')
    }

    saveCache()

    status.phase = 'done'
    invalidateTagRegistry()

    logger.info(
      {
        vaultName: config.name,
        filesProcessed: status.filesProcessed,
        notesIndexed: status.notesIndexed,
      },
      '[Obsidian] Vault sync complete',
    )
  } catch (err) {
    status.phase = 'error'
    status.lastError = err instanceof Error ? err.message : String(err)
    logger.error({ err, vaultId: config.id }, '[Obsidian] Vault sync failed')
  }

  syncStatuses.set(config.id, status)
  onProgress?.(status)
  return status
}

// ── Sync all vaults ───────────────────────────────────────────

export async function syncAllVaults(
  configs: ObsidianVaultConfig[],
  onProgress?: (status: ObsidianSyncStatus) => void,
): Promise<void> {
  const enabled = configs.filter(c => c.enabled)
  if (enabled.length === 0) return

  logger.info({ vaultCount: enabled.length }, '[Obsidian] Syncing all vaults')

  for (const config of enabled) {
    await syncVault(config, onProgress)
  }
}

// ── Upsert a single file (incremental) ───────────────────────

export async function upsertVaultFile(
  config: ObsidianVaultConfig,
  filePath: string,
): Promise<void> {
  const relPath = relative(config.vaultPath, filePath)

  // Skip template folder files
  if (config.templateFolder && relPath.startsWith(config.templateFolder)) {
    return
  }

  // Delete old chunks for this file
  await deleteFileDocuments(config.id, relPath)

  // Re-index if file still exists
  if (existsSync(filePath)) {
    let stat
    let rawContent
    try {
      stat = statSync(filePath)
      rawContent = readFileSync(filePath, 'utf-8')
      const fileHash = createHash('md5').update(rawContent).digest('hex')
      
      const result = await indexFile(config, filePath, rawContent, stat)
      updateFileCache(config.id, relPath, { mtimeMs: stat.mtimeMs, size: stat.size, hash: fileHash })
      logger.debug({ filePath: relPath, chunks: result.chunksCreated }, '[Obsidian] Upserted file')
    } catch (err) {
      logger.error({ err, filePath }, '[Obsidian] Failed to upsert file')
    }
  } else {
    removeFileCache(config.id, relPath)
    logger.debug({ filePath: relPath }, '[Obsidian] Removed deleted file from index')
  }
}

// ── File watchers ─────────────────────────────────────────────

export function startWatcher(config: ObsidianVaultConfig): void {
  stopWatcher(config.id)

  if (!existsSync(config.vaultPath)) {
    logger.warn({ vaultPath: config.vaultPath }, '[Obsidian] Cannot start watcher, path does not exist')
    return
  }

  try {
    // Debounce map to avoid re-indexing on rapid saves
    const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()

    const watcher = watch(config.vaultPath, { recursive: true }, (eventType: string, filename: string | null) => {
      if (!filename || !filename.endsWith('.md')) return

      const fullPath = join(config.vaultPath, filename)

      // Debounce: wait 500ms after last change before re-indexing
      const existing = debounceTimers.get(filename)
      if (existing) clearTimeout(existing)

      debounceTimers.set(
        filename,
        setTimeout(() => {
          debounceTimers.delete(filename)
          upsertVaultFile(config, fullPath).catch(err => {
            logger.warn({ err, file: filename }, '[Obsidian] Watcher upsert failed')
          })
        }, 500),
      )
    })

    watchers.set(config.id, watcher)
    logger.info({ vaultName: config.name }, '[Obsidian] File watcher started')
  } catch (err) {
    logger.error({ err, vaultId: config.id }, '[Obsidian] Failed to start file watcher')
  }
}

export function stopWatcher(vaultId: string): void {
  const existing = watchers.get(vaultId)
  if (existing) {
    existing.close()
    watchers.delete(vaultId)
    logger.debug({ vaultId }, '[Obsidian] File watcher stopped')
  }
}

export function stopAllWatchers(): void {
  for (const [id, watcher] of watchers) {
    watcher.close()
    logger.debug({ vaultId: id }, '[Obsidian] File watcher stopped')
  }
  watchers.clear()
}

// ── Template discovery ────────────────────────────────────────

export function listTemplates(config: ObsidianVaultConfig): ObsidianTemplate[] {
  if (!config.templateFolder) return []

  const templateDir = join(config.vaultPath, config.templateFolder)
  if (!existsSync(templateDir)) return []

  const templates: ObsidianTemplate[] = []

  let entries: string[]
  try {
    entries = readdirSync(templateDir)
  } catch {
    return []
  }

  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue

    const fullPath = join(templateDir, entry)
    try {
      const content = readFileSync(fullPath, 'utf-8')
      const { frontmatter } = parseFrontmatter(content)

      // Extract all {{field}} placeholders
      const fields: string[] = []
      let m: RegExpExecArray | null
      const regex = new RegExp(TEMPLATE_FIELD_REGEX.source, 'g')
      while ((m = regex.exec(content)) !== null) {
        const field = m[1].trim()
        if (!fields.includes(field)) {
          fields.push(field)
        }
      }

      templates.push({
        vaultId: config.id,
        name: basename(entry, '.md'),
        fileName: entry,
        rawContent: content,
        fields,
        frontmatterKeys: Object.keys(frontmatter),
      })
    } catch {
      // Skip unreadable templates
    }
  }

  return templates
}

// ── Remove all data for a vault ───────────────────────────────

export async function removeVaultData(vaultId: string): Promise<void> {
  stopWatcher(vaultId)
  syncStatuses.delete(vaultId)
  const deleted = await deleteVaultDocuments(vaultId)
  removeVaultCache(vaultId)
  invalidateTagRegistry()
  logger.info({ vaultId, deletedDocs: deleted }, '[Obsidian] Removed vault data')
}
