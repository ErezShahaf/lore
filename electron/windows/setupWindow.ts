import { BrowserWindow, screen } from 'electron'
import { join } from 'path'

let setupWindow: BrowserWindow | null = null

export function createSetupWindow(): BrowserWindow {
  if (setupWindow && !setupWindow.isDestroyed()) {
    setupWindow.focus()
    return setupWindow
  }

  const { workArea } = screen.getPrimaryDisplay()
  const width = 560
  const height = 520
  const x = Math.round(workArea.x + (workArea.width - width) / 2)
  const y = Math.round(workArea.y + (workArea.height - height) / 2)

  setupWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    resizable: false,
    maximizable: false,
    title: 'Lore — Setup',
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  const query = '?window=setup'

  if (process.env.VITE_DEV_SERVER_URL) {
    setupWindow.loadURL(process.env.VITE_DEV_SERVER_URL + query)
  } else {
    setupWindow.loadFile(join(process.env.DIST!, 'index.html'), {
      search: query,
    })
  }

  setupWindow.once('ready-to-show', () => {
    setupWindow?.show()
  })

  setupWindow.on('closed', () => {
    setupWindow = null
  })

  return setupWindow
}

export function getSetupWindow(): BrowserWindow | null {
  return setupWindow && !setupWindow.isDestroyed() ? setupWindow : null
}

export function closeSetupWindow(): void {
  if (setupWindow && !setupWindow.isDestroyed()) {
    setupWindow.close()
  }
  setupWindow = null
}
