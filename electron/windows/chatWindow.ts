import { BrowserWindow, shell } from 'electron'
import { join } from 'path'

import {
  CHAT_WINDOW_WIDTH,
  CHAT_WINDOW_DEFAULT_HEIGHT,
  CHAT_WINDOW_MIN_HEIGHT,
  CHAT_WINDOW_MAX_HEIGHT,
  SCREEN_MARGIN,
} from '../../shared/chatWindowConstants'
import { getPreferredDisplay } from '../services/displayService'
import { resetChatSessionBeforeHidingWindow } from '../services/chatSessionResetService'

let chatWindow: BrowserWindow | null = null

function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

function isAppUrl(url: string): boolean {
  if (process.env.VITE_DEV_SERVER_URL) {
    return url.startsWith(process.env.VITE_DEV_SERVER_URL)
  }

  return url.startsWith('file://')
}

function openExternalUrl(url: string): void {
  if (!isHttpUrl(url)) return
  void shell.openExternal(url)
}

function protectWindowNavigation(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) {
      openExternalUrl(url)
      return { action: 'deny' }
    }

    return { action: 'allow' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return
    if (isHttpUrl(url)) {
      event.preventDefault()
      openExternalUrl(url)
    }
  })
}

function positionChatWindow(window: BrowserWindow): void {
  const { workArea } = getPreferredDisplay()
  const [, height] = window.getSize()
  const x = workArea.x + SCREEN_MARGIN
  const y = workArea.y + workArea.height - height - SCREEN_MARGIN
  window.setPosition(x, y)
}

export function createChatWindow(): BrowserWindow {
  if (chatWindow && !chatWindow.isDestroyed()) return chatWindow

  const { workArea } = getPreferredDisplay()

  const x = workArea.x + SCREEN_MARGIN
  const y = workArea.y + workArea.height - CHAT_WINDOW_DEFAULT_HEIGHT - SCREEN_MARGIN

  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    width: CHAT_WINDOW_WIDTH,
    height: CHAT_WINDOW_DEFAULT_HEIGHT,
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
    windowOptions.hasShadow = false
  }

  chatWindow = new BrowserWindow(windowOptions)
  protectWindowNavigation(chatWindow)

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

  positionChatWindow(win)
  win.show()
  win.focus()
  win.webContents.send('chat:shown')
}

export function hideChatWindow(): void {
  const win = getChatWindow()
  if (!win) return

  resetChatSessionBeforeHidingWindow()

  win.hide()
  win.setSize(CHAT_WINDOW_WIDTH, CHAT_WINDOW_DEFAULT_HEIGHT)
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

export function repositionChatWindow(): void {
  const win = getChatWindow()
  if (!win) return

  positionChatWindow(win)
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
    const clamped = Math.max(CHAT_WINDOW_MIN_HEIGHT, Math.min(height, CHAT_WINDOW_MAX_HEIGHT))
    const [width, oldHeight] = win.getSize()
    const [xPos] = win.getPosition()
    const [, yPos] = win.getPosition()
    const newY = yPos + (oldHeight - clamped)
    win.setBounds({ x: xPos, y: newY, width, height: clamped })
  }, 16)
}
