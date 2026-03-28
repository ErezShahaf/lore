import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'fs'
import { join, basename } from 'path'
import { logger } from '../logger'
import { generateStructuredResponse } from './ollamaService'
import { getSettings } from './settingsService'
import { getTagsForContext, addTags } from './tagRegistry'
import { parseFrontmatter, listTemplates } from './obsidianService'
import type {
  ObsidianVaultConfig,
  ObsidianTemplate,
  ObsidianNoteCreationResult,
} from '../../shared/types'

// ── Template resolution ───────────────────────────────────────

export function resolveTemplate(
  config: ObsidianVaultConfig,
  templateName?: string,
): ObsidianTemplate | null {
  if (!templateName || !config.templateFolder) return null

  const templates = listTemplates(config)
  const lower = templateName.toLowerCase()

  return templates.find(t =>
    t.name.toLowerCase() === lower
    || t.fileName.toLowerCase() === `${lower}.md`
    || t.name.toLowerCase().includes(lower),
  ) ?? null
}

// ── Template schema parsing ───────────────────────────────────

const TEMPLATE_FIELD_REGEX = /\{\{([^}]+)\}\}/g

export function parseTemplateSchema(template: ObsidianTemplate): {
  fields: string[]
  frontmatterKeys: string[]
} {
  return {
    fields: template.fields,
    frontmatterKeys: template.frontmatterKeys,
  }
}

// ── LLM-powered note generation ───────────────────────────────

interface GeneratedNote {
  title: string
  frontmatter: Record<string, string | string[]>
  body: string
}

const NOTE_GENERATION_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    frontmatter: {
      type: 'object',
      additionalProperties: {
        anyOf: [
          { type: 'string' },
          { type: 'array', items: { type: 'string' } },
        ],
      },
    },
    body: { type: 'string' },
  },
  required: ['title', 'frontmatter', 'body'],
  additionalProperties: false,
}

export async function generateNoteContent(
  userIntent: string,
  template: ObsidianTemplate | null,
  existingTags: string[],
): Promise<GeneratedNote> {
  const settings = getSettings()

  const systemPrompt = buildNoteCreationSystemPrompt()
  const userPrompt = buildNoteCreationUserPrompt(userIntent, template, existingTags)

  const result = await generateStructuredResponse<GeneratedNote>({
    model: settings.selectedModel,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    schema: NOTE_GENERATION_SCHEMA,
    validate: validateGeneratedNote,
    maxAttempts: 3,
  })

  return result
}

function buildNoteCreationSystemPrompt(): string {
  return [
    'You are a note-creation assistant for an Obsidian vault.',
    'Your job is to generate well-structured Obsidian markdown notes.',
    '',
    'Rules:',
    '- Produce a JSON object with "title", "frontmatter", and "body" fields.',
    '- The "title" should be a clear, descriptive file name (no file extension).',
    '- The "frontmatter" must be a flat object with string values or string arrays.',
    '- The "body" should be proper Obsidian-flavored markdown.',
    '- When tags are provided in the existing tag pool, REUSE them wherever appropriate.',
    '- Only introduce a NEW tag if no existing tag adequately describes the concept.',
    '- Fill ALL template fields with sensible content based on the user\'s intent.',
    '- Do NOT leave any {{placeholder}} tokens unfilled.',
    '- Use markdown headers, bullet points, and formatting as appropriate.',
  ].join('\n')
}

function buildNoteCreationUserPrompt(
  userIntent: string,
  template: ObsidianTemplate | null,
  existingTags: string[],
): string {
  const parts: string[] = []

  parts.push(`User's intent: "${userIntent}"`)

  if (template) {
    const schema = parseTemplateSchema(template)
    parts.push('')
    parts.push('Template schema:')

    if (schema.frontmatterKeys.length > 0) {
      parts.push(`  Frontmatter fields: [${schema.frontmatterKeys.join(', ')}]`)
    }

    if (schema.fields.length > 0) {
      parts.push(`  Body placeholders: [${schema.fields.map(f => `{{${f}}}`).join(', ')}]`)
    }

    parts.push('')
    parts.push('Raw template content for reference:')
    parts.push('```')
    parts.push(template.rawContent)
    parts.push('```')
    parts.push('')
    parts.push('You MUST produce values for every frontmatter key and body placeholder listed above.')
  } else {
    parts.push('')
    parts.push('No template specified. Create a general note with appropriate frontmatter (at minimum: tags, date).')
  }

  if (existingTags.length > 0) {
    parts.push('')
    parts.push(`Existing tags (use these where appropriate, add new ones only if none fit):`)
    parts.push(`[${existingTags.join(', ')}]`)
  }

  parts.push('')
  parts.push('Produce a JSON object with { "title": string, "frontmatter": object, "body": string }.')

  return parts.join('\n')
}

function validateGeneratedNote(parsed: Record<string, unknown>): GeneratedNote {
  const title = typeof parsed.title === 'string' ? parsed.title.trim() : 'Untitled Note'
  const body = typeof parsed.body === 'string' ? parsed.body : ''

  let frontmatter: Record<string, string | string[]> = {}
  if (parsed.frontmatter && typeof parsed.frontmatter === 'object' && !Array.isArray(parsed.frontmatter)) {
    frontmatter = parsed.frontmatter as Record<string, string | string[]>
  }

  return { title, frontmatter, body }
}

// ── Template rendering ────────────────────────────────────────

export function renderTemplate(
  template: ObsidianTemplate,
  generated: GeneratedNote,
): string {
  let content = template.rawContent

  // Replace frontmatter keys
  const { frontmatter: templateFm } = parseFrontmatter(template.rawContent)

  // Build new frontmatter block
  const newFrontmatter = { ...templateFm }
  for (const [key, value] of Object.entries(generated.frontmatter)) {
    newFrontmatter[key] = value
  }

  // Replace built-in variables
  const now = new Date()
  const dateStr = now.toISOString().split('T')[0]
  const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

  // Replace {{field}} tokens in body
  content = content.replace(TEMPLATE_FIELD_REGEX, (match, field) => {
    const trimmedField = field.trim().toLowerCase()
    if (trimmedField === 'title') return generated.title
    if (trimmedField === 'date') return dateStr
    if (trimmedField === 'time') return timeStr

    // Check frontmatter for matching value
    const fmValue = generated.frontmatter[field.trim()]
    if (fmValue !== undefined) {
      return Array.isArray(fmValue) ? fmValue.join(', ') : String(fmValue)
    }

    // If it's a body-section placeholder, use the generated body
    if (trimmedField === 'content' || trimmedField === 'body') {
      return generated.body
    }

    return match // Leave unrecognized placeholders as-is
  })

  // Rebuild frontmatter section
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
  if (fmMatch) {
    const newFmLines: string[] = []
    for (const [key, value] of Object.entries(newFrontmatter)) {
      if (Array.isArray(value)) {
        newFmLines.push(`${key}:`)
        for (const item of value) {
          newFmLines.push(`  - ${item}`)
        }
      } else {
        newFmLines.push(`${key}: ${String(value)}`)
      }
    }
    const newFmBlock = `---\n${newFmLines.join('\n')}\n---`
    content = content.replace(fmMatch[0], newFmBlock)
  }

  return content
}

// ── Build note without template ───────────────────────────────

function buildPlainNote(generated: GeneratedNote): string {
  const now = new Date()
  const dateStr = now.toISOString().split('T')[0]

  const fmLines: string[] = ['---']

  for (const [key, value] of Object.entries(generated.frontmatter)) {
    if (Array.isArray(value)) {
      fmLines.push(`${key}:`)
      for (const item of value) {
        fmLines.push(`  - ${item}`)
      }
    } else {
      fmLines.push(`${key}: ${String(value)}`)
    }
  }

  // Ensure date is present
  if (!generated.frontmatter.date) {
    fmLines.push(`date: ${dateStr}`)
  }

  fmLines.push('---')
  fmLines.push('')
  fmLines.push(generated.body)

  return fmLines.join('\n')
}

// ── File writing ──────────────────────────────────────────────

export function sanitizeFileName(input: string): string {
  return input
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200) // Reasonable file name length limit
}

export async function writeNote(
  config: ObsidianVaultConfig,
  title: string,
  content: string,
): Promise<string> {
  const destDir = config.noteDestination
    ? join(config.vaultPath, config.noteDestination)
    : config.vaultPath

  // Ensure destination directory exists
  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true })
  }

  const safeName = sanitizeFileName(title)
  let filePath = join(destDir, `${safeName}.md`)

  // Avoid overwriting existing files — append a number
  let counter = 1
  while (existsSync(filePath)) {
    filePath = join(destDir, `${safeName} ${counter}.md`)
    counter++
  }

  writeFileSync(filePath, content, 'utf-8')
  logger.info({ filePath, title }, '[Obsidian] Created note')
  return filePath
}

// ── Main entry: create note from intent ───────────────────────

export async function createObsidianNote(
  config: ObsidianVaultConfig,
  userIntent: string,
  templateName?: string,
): Promise<ObsidianNoteCreationResult> {
  // Resolve template
  const template = templateName ? resolveTemplate(config, templateName) : null

  // Get tag pool for consistency
  const existingTags = getTagsForContext(200)

  // Generate note content via LLM
  const generated = await generateNoteContent(userIntent, template, existingTags)

  // Render final content
  const content = template
    ? renderTemplate(template, generated)
    : buildPlainNote(generated)

  // Write to vault
  const filePath = await writeNote(config, generated.title, content)

  // Update tag registry with any new tags
  const appliedTags = Array.isArray(generated.frontmatter.tags)
    ? generated.frontmatter.tags
    : typeof generated.frontmatter.tags === 'string'
      ? generated.frontmatter.tags.split(',').map(s => s.trim()).filter(Boolean)
      : []

  if (appliedTags.length > 0) {
    addTags(appliedTags)
  }

  return {
    filePath,
    title: generated.title,
    vaultName: config.name,
    templateUsed: template?.name ?? null,
    tagsApplied: appliedTags,
  }
}
