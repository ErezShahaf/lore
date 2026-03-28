import { logger } from '../logger'
import { getAllDocuments } from './lanceService'

/**
 * Global tag registry — maintains a deduplicated pool of all tags
 * across Lore notes and Obsidian vaults. Used during note creation
 * to constrain the LLM to reuse existing tags before coining new ones.
 */

interface TagEntry {
  tag: string
  count: number
}

let tagPool: Map<string, number> = new Map()
let initialized = false

// ── Build & maintain ──────────────────────────────────────────

export async function buildRegistry(): Promise<void> {
  const nextPool = new Map<string, number>()

  try {
    const allDocs = await getAllDocuments(false)

    for (const doc of allDocs) {
      // Harvest from the LoreDocument tags column (comma-separated)
      if (doc.tags) {
        const csvTags = doc.tags.split(',').map(t => t.trim()).filter(Boolean)
        for (const tag of csvTags) {
          const lower = tag.toLowerCase()
          nextPool.set(lower, (nextPool.get(lower) ?? 0) + 1)
        }
      }

      // Harvest from Obsidian frontmatter stored in metadata
      if (doc.source === 'obsidian' && doc.metadata) {
        try {
          const meta = JSON.parse(doc.metadata)
          const fmTags = meta?.frontmatter?.tags
          if (Array.isArray(fmTags)) {
            for (const tag of fmTags) {
              if (typeof tag === 'string' && tag.trim()) {
                const lower = tag.trim().toLowerCase()
                nextPool.set(lower, (nextPool.get(lower) ?? 0) + 1)
              }
            }
          } else if (typeof fmTags === 'string') {
            // Inline YAML tags: "tag1, tag2, tag3"
            const parts = fmTags.split(',').map(t => t.trim()).filter(Boolean)
            for (const tag of parts) {
              const lower = tag.toLowerCase()
              nextPool.set(lower, (nextPool.get(lower) ?? 0) + 1)
            }
          }
        } catch {
          // skip unparseable metadata
        }
      }
    }

    tagPool = nextPool
    initialized = true
    logger.info({ tagCount: tagPool.size }, '[TagRegistry] Built tag registry')
  } catch (err) {
    logger.error({ err }, '[TagRegistry] Failed to build tag registry')
  }
}

export function invalidate(): void {
  initialized = false
  tagPool = new Map()
}

// ── Query ─────────────────────────────────────────────────────

export function getAllTags(): string[] {
  return [...tagPool.keys()].sort()
}

export function getTagEntries(): TagEntry[] {
  return [...tagPool.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
}

export function getTagsForContext(limit = 200): string[] {
  return getTagEntries()
    .slice(0, limit)
    .map(e => e.tag)
}

/**
 * Fuzzy-match existing tags against the words in the given text.
 * Returns tags where either the tag contains a word or a word contains the tag.
 */
export function suggestTags(text: string, limit = 20): string[] {
  const words = text
    .toLowerCase()
    .split(/[\s,;:.!?/\\()\[\]{}"']+/)
    .filter(w => w.length > 2)

  const scored = new Map<string, number>()

  for (const [tag] of tagPool) {
    for (const word of words) {
      if (tag.includes(word) || word.includes(tag)) {
        scored.set(tag, (scored.get(tag) ?? 0) + 1)
      }
    }
  }

  return [...scored.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([tag]) => tag)
}

/**
 * Merge new tags into the pool after creating a note.
 * Avoids full rebuild for incremental updates.
 */
export function addTags(tags: string[]): void {
  for (const tag of tags) {
    const lower = tag.trim().toLowerCase()
    if (!lower) continue
    tagPool.set(lower, (tagPool.get(lower) ?? 0) + 1)
  }
}

export function isInitialized(): boolean {
  return initialized
}

export function getTagCount(): number {
  return tagPool.size
}
