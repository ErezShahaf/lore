import { basename, dirname, join } from 'path'
import { rmSync, existsSync, readFileSync } from 'fs'
import { env, platform } from 'process'

const packageJsonPath = new URL('../package.json', import.meta.url)
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
const defaultAppName = packageJson.name || 'lore'

function getArgumentValue(flagName) {
  const flagIndex = process.argv.indexOf(flagName)
  if (flagIndex === -1) {
    return null
  }

  return process.argv[flagIndex + 1] || null
}

function getBooleanFlag(flagName) {
  return process.argv.includes(flagName)
}

function getDefaultUserDataPath() {
  const appName = defaultAppName

  switch (platform) {
    case 'win32':
      return join(env.APPDATA || join(env.USERPROFILE, 'AppData', 'Roaming'), appName)
    case 'darwin':
      return join(env.HOME, 'Library', 'Application Support', appName)
    default:
      return join(env.XDG_CONFIG_HOME || join(env.HOME, '.config'), appName)
  }
}

function resolveRuntimeProfile() {
  const argumentProfile = getArgumentValue('--profile')
  const envProfile = env.LORE_RUNTIME_PROFILE
  const rawProfile = (argumentProfile || envProfile || 'dev').trim().toLowerCase()

  if (rawProfile === 'real' || rawProfile === 'dev' || rawProfile === 'eval') {
    return rawProfile
  }

  throw new Error(`Unsupported profile "${rawProfile}". Use real, dev, or eval.`)
}

function buildProfiledUserDataPath(defaultUserDataPath, profile) {
  if (profile === 'real') {
    return defaultUserDataPath
  }

  return join(dirname(defaultUserDataPath), `${basename(defaultUserDataPath)}-${profile}`)
}

const runtimeProfile = resolveRuntimeProfile()
const explicitUserDataPath = getArgumentValue('--user-data-dir') || env.LORE_USER_DATA_DIR || null
const allowRealReset = getBooleanFlag('--allow-real')
const userDataPath = explicitUserDataPath
  ? explicitUserDataPath
  : buildProfiledUserDataPath(getDefaultUserDataPath(), runtimeProfile)

if (runtimeProfile === 'real' && !allowRealReset) {
  console.error('Refusing to clear the real profile without --allow-real.')
  process.exit(1)
}

const dbPath = join(userDataPath, 'lore-db')

if (!existsSync(dbPath)) {
  console.log(`Nothing to remove — ${dbPath} does not exist.`)
  process.exit(0)
}

rmSync(dbPath, { recursive: true, force: true })
console.log(`Cleared vector DB for profile "${runtimeProfile}" at ${dbPath}`)
