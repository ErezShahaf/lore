import { Tray, Menu, nativeImage, app } from 'electron'
import { join } from 'path'
import { showChatWindow } from '../windows/chatWindow'
import { createSettingsWindow } from '../windows/settingsWindow'

let tray: Tray | null = null

function getIconPath(): string {
  const isDev = !!process.env.VITE_DEV_SERVER_URL
  if (isDev) {
    return join(__dirname, '..', 'resources', 'icon.png')
  }
  return join(process.resourcesPath, 'icon.png')
}

export function createTray(): Tray {
  if (tray) return tray

  const iconPath = getIconPath()
  let icon = nativeImage.createFromPath(iconPath)

  if (icon.isEmpty()) {
    icon = nativeImage.createEmpty()
  }

  icon = icon.resize({ width: 16, height: 16 })

  tray = new Tray(icon)
  tray.setToolTip('Lore')

  if (process.platform === 'darwin') {
    app.dock?.hide()
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Lore',
      click: () => showChatWindow(),
    },
    {
      label: 'Settings',
      click: () => createSettingsWindow(),
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => app.quit(),
    },
  ])

  tray.setContextMenu(contextMenu)

  tray.on('click', () => showChatWindow())

  return tray
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy()
    tray = null
  }
}
