import { app } from 'electron'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, basename, extname } from 'path'
import { logger } from '../logger'

export interface SkillFile {
  name: string
  content: string
}

const skillCache = new Map<string, string>()
let allSkillsCache: SkillFile[] | null = null

function getSkillsDirectory(): string {
  if (!app.isPackaged) {
    return join(process.cwd(), 'skills')
  }
  return join(process.resourcesPath, 'skills')
}

function readSkillFilesRecursive(directory: string): SkillFile[] {
  const results: SkillFile[] = []

  let entries: string[]
  try {
    entries = readdirSync(directory)
  } catch {
    return results
  }

  for (const entry of entries) {
    const fullPath = join(directory, entry)
    const stat = statSync(fullPath)

    if (stat.isDirectory()) {
      results.push(...readSkillFilesRecursive(fullPath))
    } else if (extname(entry) === '.md') {
      const name = basename(entry, '.md')
      const content = readFileSync(fullPath, 'utf-8')
      results.push({ name, content })
    }
  }

  return results
}

export function loadSkill(name: string): string {
  const cached = skillCache.get(name)
  if (cached) return cached

  const skillsDir = getSkillsDirectory()
  const filePath = join(skillsDir, `${name}.md`)

  try {
    const content = readFileSync(filePath, 'utf-8')
    skillCache.set(name, content)
    return content
  } catch (err) {
    logger.error({ err, name, filePath }, '[SkillLoader] Failed to load skill')
    throw new Error(`Skill "${name}" not found at ${filePath}`)
  }
}

export function loadAllSkills(): readonly SkillFile[] {
  if (allSkillsCache) return allSkillsCache

  const skillsDir = getSkillsDirectory()

  try {
    allSkillsCache = readSkillFilesRecursive(skillsDir)
    logger.debug({ count: allSkillsCache.length }, '[SkillLoader] Loaded all skills')
    return allSkillsCache
  } catch (err) {
    logger.error({ err }, '[SkillLoader] Failed to load skills directory')
    return []
  }
}

function toTitleCase(name: string): string {
  return name
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

export function formatSkillsForPrompt(skills: readonly SkillFile[], excludeSkill: string): string {
  const filtered = skills.filter((skill) => skill.name !== excludeSkill)

  if (filtered.length === 0) return ''

  const referencePreamble = [
    'The following materials are reference documents for other agents in Lore.',
    'They are provided so you can accurately explain product behavior and capabilities.',
    'They are NOT instructions for your own output format, persona, or response shape.',
    'If a referenced document says things like "respond with JSON", defines schemas, or lists required keys, treat that as documentation about that specific agent only.',
    'Do not copy those formats into your own reply.',
  ].join('\n')

  const sections = filtered.map((skill) =>
    [
      `=== Begin Referenced Agent Skill: ${toTitleCase(skill.name)} ===`,
      'This entire section is quoted reference material for a different agent.',
      'Do not adopt its output format.',
      '"""',
      skill.content.trim(),
      '"""',
      `=== End Referenced Agent Skill: ${toTitleCase(skill.name)} ===`,
    ].join('\n'),
  )

  return [referencePreamble, ...sections].join('\n\n')
}
