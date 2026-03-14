import { BrowserWindow, screen } from 'electron'
import { join } from 'path'

let chatWindow: BrowserWindow | null = null

const CHAT_WIDTH = 416
const CHAT_DEFAULT_HEIGHT = 80
const SCREEN_MARGIN = 20

export function createChatWindow(): BrowserWindow {
  if (chatWindow && !chatWindow.isDestroyed()) return chatWindow

  const { workArea } = screen.getPrimaryDisplay()

  const x = workArea.x + SCREEN_MARGIN
  const y = workArea.y + workArea.height - CHAT_DEFAULT_HEIGHT - SCREEN_MARGIN

  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    width: CHAT_WIDTH,
    height: CHAT_DEFAULT_HEIGHT,
    x,
    y,
    frame: false,
    alwaysOnTop: true,
    transparent: true,
    backgroundColor: '#00000000',
    skipTaskbar: true,
    resizable: false,
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  }

  if (process.platform === 'darwin') {
    windowOptions.vibrancy = 'under-window'
    windowOptions.visualEffectState = 'active'
  }


  chatWindow = new BrowserWindow(windowOptions)

  if (process.env.VITE_DEV_SERVER_URL) {
    chatWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    chatWindow.loadFile(join(process.env.DIST!, 'index.html'))
  }

  chatWindow.on('closed', () => {
    chatWindow = null
  })

  return chatWindow
}

export function getChatWindow(): BrowserWindow | null {
  return chatWindow && !chatWindow.isDestroyed() ? chatWindow : null
}

export function showChatWindow(): void {
  const win = getChatWindow()
  if (!win) return

  const { workArea } = screen.getPrimaryDisplay()
  const [, height] = win.getSize()
  const x = workArea.x + SCREEN_MARGIN
  const y = workArea.y + workArea.height - height - SCREEN_MARGIN
  win.setPosition(x, y)

  win.show()
  win.focus()
  win.webContents.send('chat:shown')
}

export function hideChatWindow(): void {
  const win = getChatWindow()
  if (!win) return

  win.hide()
  win.setSize(CHAT_WIDTH, CHAT_DEFAULT_HEIGHT)
  win.webContents.send('chat:reset')
}

export function hideChatWindowAnimated(): void {
  const win = getChatWindow()
  if (!win || !win.isVisible()) return

  win.webContents.send('chat:will-hide')

  setTimeout(() => {
    if (win && !win.isDestroyed() && win.isVisible()) {
      hideChatWindow()
    }
  }, 300)
}

export function toggleChatWindow(): void {
  const win = getChatWindow()
  if (!win) return

  if (win.isVisible()) {
    hideChatWindowAnimated()
  } else {
    showChatWindow()
  }
}

let resizeTimer: ReturnType<typeof setTimeout> | null = null

export function resizeChatWindow(height: number): void {
  const win = getChatWindow()
  if (!win) return

  if (resizeTimer) clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => {
    if (!win || win.isDestroyed()) return
    const clamped = Math.max(CHAT_DEFAULT_HEIGHT, Math.min(height, 480))
    const [width, oldHeight] = win.getSize()
    const [xPos] = win.getPosition()
    const [, yPos] = win.getPosition()
    const newY = yPos + (oldHeight - clamped)
    win.setBounds({ x: xPos, y: newY, width, height: clamped })
  }, 16)
}
