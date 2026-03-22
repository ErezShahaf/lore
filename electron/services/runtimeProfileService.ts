import { existsSync, mkdirSync } from 'fs'
import { basename, dirname, join } from 'path'
import { app } from 'electron'

export type RuntimeProfile = 'real' | 'dev' | 'eval'

const RUNTIME_PROFILE_ENV = 'LORE_RUNTIME_PROFILE'
const USER_DATA_DIR_ENV = 'LORE_USER_DATA_DIR'

interface RuntimeProfileState {
  readonly profile: RuntimeProfile
  readonly userDataPath: string
}

let cachedRuntimeProfileState: RuntimeProfileState | null = null

function isRuntimeProfile(value: string): value is RuntimeProfile {
  return value === 'real' || value === 'dev' || value === 'eval'
}

function ensureDirectory(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true })
  }
}

export function resolveRuntimeProfile(env: NodeJS.ProcessEnv = process.env): RuntimeProfile {
  const rawProfile = env[RUNTIME_PROFILE_ENV]?.trim().toLowerCase()
  if (rawProfile && isRuntimeProfile(rawProfile)) {
    return rawProfile
  }

  return env.VITE_DEV_SERVER_URL ? 'dev' : 'real'
}

function buildProfiledUserDataPath(defaultUserDataPath: string, profile: RuntimeProfile): string {
  if (profile === 'real') {
    return defaultUserDataPath
  }

  const parentDirectory = dirname(defaultUserDataPath)
  const appDirectoryName = basename(defaultUserDataPath)
  return join(parentDirectory, `${appDirectoryName}-${profile}`)
}

export function configureRuntimeProfile(): RuntimeProfileState {
  if (cachedRuntimeProfileState) {
    return cachedRuntimeProfileState
  }

  const profile = resolveRuntimeProfile()
  const defaultUserDataPath = app.getPath('userData')
  const explicitUserDataPath = process.env[USER_DATA_DIR_ENV]?.trim()
  const resolvedUserDataPath = explicitUserDataPath && explicitUserDataPath.length > 0
    ? explicitUserDataPath
    : buildProfiledUserDataPath(defaultUserDataPath, profile)

  ensureDirectory(resolvedUserDataPath)

  if (resolvedUserDataPath !== defaultUserDataPath) {
    app.setPath('userData', resolvedUserDataPath)
  }

  process.env.LORE_ACTIVE_RUNTIME_PROFILE = profile
  process.env.LORE_ACTIVE_USER_DATA_DIR = resolvedUserDataPath

  cachedRuntimeProfileState = {
    profile,
    userDataPath: resolvedUserDataPath,
  }

  return cachedRuntimeProfileState
}

export function getRuntimeProfile(): RuntimeProfile {
  return cachedRuntimeProfileState?.profile ?? resolveRuntimeProfile()
}

export function isEvalRuntimeProfile(): boolean {
  return getRuntimeProfile() === 'eval'
}
