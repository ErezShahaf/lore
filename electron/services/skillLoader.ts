import { app } from 'electron'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, basename, extname } from 'path'
import { SKILL_MOUNT_SEGMENTS } from '../../shared/skillTreeSpec'
import { logger } from '../logger'

export interface SkillFile {
  name: string
  content: string
}

export type SkillPromptSelectors = Readonly<Partial<Record<string, string>>>

/** Loader id for the unified classifier (`skills/skill-classification/entry.md` only — no subtree). */
export const FIRST_TURN_SKILL_ID = 'skill-classification' as const

const CLASSIFICATION_FOLDER_NAME = 'skill-classification' as const

const skillCache = new Map<string, string>()
let allSkillsCache: SkillFile[] | null = null

function getSkillsDirectory(): string {
  if (!app.isPackaged) {
    return join(process.cwd(), 'skills')
  }
  return join(process.resourcesPath, 'skills')
}

function fileExists(filePath: string): boolean {
  try {
    return statSync(filePath).isFile()
  } catch {
    return false
  }
}

function directoryExists(directoryPath: string): boolean {
  try {
    return statSync(directoryPath).isDirectory()
  } catch {
    return false
  }
}

function readTextFile(filePath: string): string {
  return readFileSync(filePath, 'utf-8')
}

function getSkillCacheKey(name: string, selectors?: SkillPromptSelectors): string {
  if (!selectors || Object.keys(selectors).length === 0) return name
  const sortedEntries = Object.entries(selectors).sort(([aKey], [bKey]) => aKey.localeCompare(bKey))
  const normalized = sortedEntries.map(([key, value]) => `${key}=${value}`).join(';')
  return `${name}::${normalized}`
}

/**
 * When a skill has multiple `decisions/<decisionKey>/` directories, merge order follows this list first,
 * then any other keys alphabetically. Matches `question-answer` pipeline: retrieval, todo shape, structured bodies.
 */
const DECISION_KEY_MERGE_PRIORITY: readonly string[] = [
  'retrievalStatus',
  'todoListing',
  'structuredRetrieved',
  'kind',
]

function sortDecisionKeys(decisionKeys: readonly string[]): string[] {
  const priorityIndex = (key: string): number => {
    const index = DECISION_KEY_MERGE_PRIORITY.indexOf(key)
    return index === -1 ? DECISION_KEY_MERGE_PRIORITY.length : index
  }
  return [...decisionKeys].sort((a, b) => {
    const delta = priorityIndex(a) - priorityIndex(b)
    return delta !== 0 ? delta : a.localeCompare(b)
  })
}

function assembleForkedSkillPrompt(skillDir: string, selectors: SkillPromptSelectors): string {
  const visitedEntryFiles = new Set<string>()
  const promptParts: string[] = []

  function walk(nodeDir: string): void {
    const entryPath = join(nodeDir, 'entry.md')
    if (fileExists(entryPath) && !visitedEntryFiles.has(entryPath)) {
      visitedEntryFiles.add(entryPath)
      const part = readTextFile(entryPath).trim()
      if (part.length > 0) {
        promptParts.push(part)
      }
    }

    const decisionsDir = join(nodeDir, 'decisions')
    if (!directoryExists(decisionsDir)) return

    let decisionKeys: string[] = []
    try {
      decisionKeys = sortDecisionKeys(
        readdirSync(decisionsDir).filter((entry) => directoryExists(join(decisionsDir, entry))),
      )
    } catch {
      return
    }

    for (const decisionKey of decisionKeys) {
      const chosenValue = selectors[decisionKey]
      const chosenDir = chosenValue
        ? join(decisionsDir, decisionKey, chosenValue)
        : null

      if (chosenDir && directoryExists(chosenDir)) {
        walk(chosenDir)
        continue
      }

      const defaultDir = join(decisionsDir, decisionKey, 'default')
      if (directoryExists(defaultDir)) {
        walk(defaultDir)
      }
    }
  }

  walk(skillDir)

  return promptParts.join('\n\n---\n\n')
}

function loadLegacySkill(skillsDir: string, name: string): string {
  const filePath = join(skillsDir, `${name}.md`)
  return readTextFile(filePath)
}

function getClassificationRootDirectory(skillsDir: string): string {
  return join(skillsDir, CLASSIFICATION_FOLDER_NAME)
}

function resolveMountedSkillDirectory(skillsDir: string, name: string): string | null {
  const segments = SKILL_MOUNT_SEGMENTS[name]
  if (!segments) return null
  return join(getClassificationRootDirectory(skillsDir), ...segments)
}

function collectAncestorEntryFragments(
  classificationRoot: string,
  segments: readonly string[],
): string[] {
  const fragments: string[] = []
  for (let index = 0; index < segments.length - 1; index += 1) {
    const ancestorDir = join(classificationRoot, ...segments.slice(0, index + 1))
    const entryPath = join(ancestorDir, 'entry.md')
    if (!fileExists(entryPath)) continue
    const part = readTextFile(entryPath).trim()
    if (part.length > 0) {
      fragments.push(part)
    }
  }
  return fragments
}

function loadClassificationRootOnly(skillsDir: string): string {
  const entryPath = join(getClassificationRootDirectory(skillsDir), 'entry.md')
  if (!fileExists(entryPath)) {
    throw new Error(`Classification skill not found at ${entryPath}`)
  }
  return readTextFile(entryPath).trim()
}

function loadForkedSkillAtDirectory(skillDir: string, selectors: SkillPromptSelectors): string {
  const entryPath = join(skillDir, 'entry.md')
  if (!fileExists(entryPath)) {
    throw new Error(`Skill directory has no entry.md at ${entryPath}`)
  }
  return assembleForkedSkillPrompt(skillDir, selectors)
}

function loadForkedSkill(skillsDir: string, name: string, selectors: SkillPromptSelectors): string {
  const mountDir = resolveMountedSkillDirectory(skillsDir, name)
  if (mountDir !== null) {
    const classificationRoot = getClassificationRootDirectory(skillsDir)
    const segments = SKILL_MOUNT_SEGMENTS[name]
    if (!segments) {
      throw new Error(`Mount segments missing for skill "${name}"`)
    }
    const ancestors = collectAncestorEntryFragments(classificationRoot, segments)
    const body = loadForkedSkillAtDirectory(mountDir, selectors)
    if (ancestors.length === 0) {
      return body
    }
    return [...ancestors, body].join('\n\n---\n\n')
  }

  const skillDir = join(skillsDir, name)
  const entryPath = join(skillDir, 'entry.md')
  if (!fileExists(entryPath)) {
    throw new Error(`Skill "${name}" not found at ${entryPath}`)
  }
  return assembleForkedSkillPrompt(skillDir, selectors)
}

export function loadSkill(name: string, selectors: SkillPromptSelectors = {}): string {
  const cacheKey = getSkillCacheKey(name, selectors)
  const cached = skillCache.get(cacheKey)
  if (cached) return cached

  const skillsDir = getSkillsDirectory()

  try {
    if (name === FIRST_TURN_SKILL_ID) {
      const content = loadClassificationRootOnly(skillsDir)
      skillCache.set(cacheKey, content)
      return content
    }

    const mountDir = resolveMountedSkillDirectory(skillsDir, name)
    const forkEntryPath =
      mountDir !== null
        ? join(mountDir, 'entry.md')
        : join(skillsDir, name, 'entry.md')

    const content = fileExists(forkEntryPath)
      ? loadForkedSkill(skillsDir, name, selectors)
      : loadLegacySkill(skillsDir, name)

    skillCache.set(cacheKey, content)
    return content
  } catch (err) {
    const mountDir = resolveMountedSkillDirectory(skillsDir, name)
    const forkEntryPath =
      mountDir !== null
        ? join(mountDir, 'entry.md')
        : join(skillsDir, name, 'entry.md')
    const legacyPath = join(skillsDir, `${name}.md`)
    logger.error({ err, name, legacyPath, forkEntryPath }, '[SkillLoader] Failed to load skill')
    throw new Error(`Skill "${name}" not found at ${legacyPath} or ${forkEntryPath}`)
  }
}

export function loadSkillSection(
  name: string,
  startMarker: string,
  endMarker: string,
): string {
  const full = loadSkill(name)
  const startIndex = full.indexOf(startMarker)
  const endIndex = full.indexOf(endMarker)
  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    logger.warn({ name, startMarker, endMarker }, '[SkillLoader] Section markers not found')
    return full
  }
  return full
    .slice(startIndex + startMarker.length, endIndex)
    .trim()
}

export function loadAllSkills(): readonly SkillFile[] {
  if (allSkillsCache) return allSkillsCache

  const skillsDir = getSkillsDirectory()
  let entries: string[] = []
  try {
    entries = readdirSync(skillsDir)
  } catch (err) {
    logger.error({ err }, '[SkillLoader] Failed to load skills directory')
    return []
  }

  const results: SkillFile[] = []
  for (const entry of entries) {
    const fullPath = join(skillsDir, entry)
    const stat = statSync(fullPath)

    if (stat.isFile() && extname(entry) === '.md') {
      const skillName = basename(entry, '.md')
      results.push({ name: skillName, content: readTextFile(fullPath) })
      continue
    }

    if (stat.isDirectory()) {
      const entryMdPath = join(fullPath, 'entry.md')
      if (fileExists(entryMdPath)) {
        results.push({ name: entry, content: readTextFile(entryMdPath) })
      }
    }
  }

  allSkillsCache = results
  logger.debug({ count: allSkillsCache.length }, '[SkillLoader] Loaded all skills')
  return allSkillsCache
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
