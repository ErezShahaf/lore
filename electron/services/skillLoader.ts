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
  const isDev = !!process.env.VITE_DEV_SERVER_URL
  if (isDev) {
    return join(__dirname, '..', 'skills')
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

  const sections = filtered.map((skill) =>
    `=== Agent Skill: ${toTitleCase(skill.name)} ===\n${skill.content.trim()}\n=== End of Skill: ${toTitleCase(skill.name)} ===`,
  )

  return sections.join('\n\n')
}
