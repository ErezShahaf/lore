import { join } from 'path'
import { rmSync, existsSync } from 'fs'
import { env, platform } from 'process'

function getUserDataPath() {
  const appName = 'lore'

  switch (platform) {
    case 'win32':
      return join(env.APPDATA || join(env.USERPROFILE, 'AppData', 'Roaming'), appName)
    case 'darwin':
      return join(env.HOME, 'Library', 'Application Support', appName)
    default:
      return join(env.XDG_CONFIG_HOME || join(env.HOME, '.config'), appName)
  }
}

const dbPath = join(getUserDataPath(), 'lore-db')

if (!existsSync(dbPath)) {
  console.log(`Nothing to remove — ${dbPath} does not exist.`)
  process.exit(0)
}

rmSync(dbPath, { recursive: true, force: true })
console.log(`Cleared vector DB at ${dbPath}`)
