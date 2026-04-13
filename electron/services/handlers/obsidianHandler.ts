import { logger } from '../../logger'
import { getSettings } from '../settingsService'
import { createObsidianNote } from '../obsidianNoteWriter'
import { storeThought } from '../documentPipeline'
import { formatLocalDate } from '../localDate'
import type {
  ClassificationResult,
  AgentEvent,
  ConversationEntry,
  ObsidianVaultConfig,
} from '../../../shared/types'

/**
 * Handles explicit "create Obsidian note" intents.
 *
 * Flow:
 *   1. Determine target vault (single vault → use it; multiple → use first enabled)
 *   2. Extract template name from user input if mentioned
 *   3. Call obsidianNoteWriter to generate + write the note
 *   4. Store a reference document in LanceDB for RAG
 *   5. Yield confirmation
 */
export async function* handleObsidianCreate(
  userInput: string,
  classification: ClassificationResult,
  conversationHistory: readonly ConversationEntry[] = [],
): AsyncGenerator<AgentEvent> {
  const settings = getSettings()
  const enabledVaults = settings.obsidianVaults.filter(v => v.enabled)

  if (enabledVaults.length === 0) {
    yield {
      type: 'chunk',
      content: 'No Obsidian vaults are configured. Please add a vault in Settings → Obsidian to use this feature.',
    }
    yield { type: 'done' }
    return
  }

  yield { type: 'status', message: 'Creating Obsidian note...' }

  // Determine target vault
  const targetVault = resolveTargetVault(userInput, enabledVaults)

  // Extract template name from user input
  const templateName = extractTemplateName(userInput)

  try {
    const result = await createObsidianNote(targetVault, userInput, templateName)

    // Store a reference in LanceDB so it's immediately searchable
    const today = formatLocalDate(new Date())
    const refDoc = await storeThought({
      content: `[Obsidian Note] ${result.title} — Created in ${result.vaultName}${result.templateUsed ? ` using template "${result.templateUsed}"` : ''}`,
      originalInput: userInput,
      type: 'obsidian-note',
      date: classification.extractedDate ?? today,
      tags: result.tagsApplied,
    })

    yield { type: 'stored', documentId: refDoc.id }

    // Build confirmation message
    const parts = [`✅ Created note **"${result.title}"** in your **${result.vaultName}** vault.`]

    if (result.templateUsed) {
      parts.push(`📝 Template used: ${result.templateUsed}`)
    }

    if (result.tagsApplied.length > 0) {
      parts.push(`🏷️ Tags: ${result.tagsApplied.join(', ')}`)
    }

    yield { type: 'chunk', content: parts.join('\n') }
  } catch (err) {
    logger.error({ err }, '[ObsidianHandler] Failed to create note')
    yield {
      type: 'error',
      message: err instanceof Error ? err.message : 'Failed to create Obsidian note',
    }
  }

  yield { type: 'done' }
}

/**
 * Pick the right vault based on user mention (e.g. "in my Work vault")
 * or default to first enabled vault.
 */
function resolveTargetVault(
  userInput: string,
  enabledVaults: ObsidianVaultConfig[],
): ObsidianVaultConfig {
  const lower = userInput.toLowerCase()

  // Try to match vault name in the user input
  for (const vault of enabledVaults) {
    const vaultNameLower = vault.name.toLowerCase()
    if (lower.includes(vaultNameLower) && vaultNameLower.length > 2) {
      return vault
    }
  }

  // Default to first enabled vault
  return enabledVaults[0]
}

/**
 * Extract template name from phrases like:
 *   "using my Meeting template"
 *   "with the Research template"
 *   "use the Daily template"
 */
function extractTemplateName(userInput: string): string | undefined {
  const patterns = [
    /(?:using|use|with)\s+(?:my|the|a)?\s*["""]?(\w[\w\s-]*?)["""]?\s+template/i,
    /template\s*[:=]\s*["""]?(\w[\w\s-]*?)["""]?(?:\s|$|,|\.)/i,
  ]

  for (const pattern of patterns) {
    const match = userInput.match(pattern)
    if (match && match[1]) {
      return match[1].trim()
    }
  }

  return undefined
}
