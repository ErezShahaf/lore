# Phase 2 — System Tray & Global Shortcut

## Goal

Make Lore behave like a background utility: it sits in the system tray (Windows notification area / macOS menu bar), registers a global keyboard shortcut, and toggles a spotlight-style frameless popup window centered on screen. The app starts minimized to tray on launch.

## Prerequisites

- Phase 1 complete (Electron shell with React rendering)

## Steps

### 2.1 System tray setup

`electron/tray/trayManager.ts`:

- Create a `Tray` instance with the app icon
- Build a context menu with:
  - **Open Lore** — shows the chat popup
  - **Settings** — opens the settings window (placeholder for now)
  - **Quit** — exits the app
- On Windows: the tray icon appears in the notification area (bottom-right, next to clock)
- On macOS: the tray icon appears in the menu bar
- Store the tray instance so it is not garbage collected

Integrate into `electron/main.ts`:
- Call tray setup in `app.whenReady()`
- When the main window is closed, hide it instead of destroying it (keep the app running in tray)
- On macOS, handle `app.on('activate')` to re-show the window

### 2.2 Chat popup window configuration

`electron/windows/chatWindow.ts`:

Create a dedicated module for managing the chat popup `BrowserWindow`:

- **Frameless**: `frame: false`
- **Always on top**: `alwaysOnTop: true`
- **Transparent background**: `transparent: true` (for rounded corners and opacity effects)
- **No taskbar icon**: `skipTaskbar: true`
- **Centered on screen**: calculate center position based on primary display size
- **Initial size**: width ~600px, height ~80px (just the input bar)
- **Resizable**: `false` (height is controlled programmatically)
- **Show on ready**: `false` (window is hidden by default)
- **webPreferences**: same security settings as Phase 1 (contextIsolation, preload)

Export functions:
- `createChatWindow()` — creates and returns the window (does not show it)
- `toggleChatWindow()` — shows the window if hidden, hides if visible
- `showChatWindow()` — shows + focuses the window
- `hideChatWindow()` — hides the window
- `resizeChatWindow(height: number)` — smoothly resizes the window height (for when responses appear)

### 2.3 Global shortcut registration

In `electron/main.ts` (or a dedicated `electron/shortcuts.ts`):

- Use `globalShortcut.register()` to bind a toggle shortcut:
  - Default: `CommandOrControl+Shift+Space`
  - This calls `toggleChatWindow()`
- Register the shortcut in `app.whenReady()`
- Unregister all shortcuts in `app.will-quit`
- Handle registration failure gracefully (log warning, show tray notification)

### 2.4 Window positioning and display behavior

When showing the chat window:
1. Get the primary display's work area (`screen.getPrimaryDisplay().workArea`)
2. Calculate center X and Y
3. Position the window at center-X, slightly above center-Y (like Spotlight)
4. Call `window.show()` and `window.focus()`

When hiding:
1. Call `window.hide()`
2. Optionally clear the chat input (send IPC message to renderer to reset)

### 2.5 IPC for window resizing

The renderer needs to tell the main process when to resize the chat window (e.g., when a response arrives and needs more vertical space).

Add to `electron/preload.ts`:
- `loreAPI.resizeChatWindow(height: number)` — calls IPC to resize
- `loreAPI.hideChatWindow()` — calls IPC to hide the popup

Add to `electron/ipc/handlers.ts`:
- Handle `chat:resize` channel
- Handle `chat:hide` channel

### 2.6 Hide on blur (optional but recommended)

When the chat popup loses focus (user clicks elsewhere), automatically hide it:
- Listen to `BrowserWindow.on('blur')` event
- Call `hideChatWindow()`
- This mimics Spotlight behavior

Make this configurable since some users may want the window to stay open.

### 2.7 Prevent multiple instances

Use `app.requestSingleInstanceLock()` to ensure only one instance of Lore runs. If a second instance is launched:
- Focus the existing instance
- Show the chat popup

### 2.8 Start on login (optional, prep for Phase 8)

Add `app.setLoginItemSettings({ openAtLogin: true })` — but make this a setting that can be toggled. For now, just add the infrastructure; the actual setting toggle comes in Phase 3.

## IPC Channels Introduced

| Channel         | Direction        | Payload             | Purpose                        |
| --------------- | ---------------- | ------------------- | ------------------------------ |
| `chat:resize`   | Renderer → Main  | `{ height: number }` | Resize the chat popup height   |
| `chat:hide`     | Renderer → Main  | none                | Hide the chat popup            |
| `chat:reset`    | Main → Renderer  | none                | Clear chat input on hide       |

## Verification

1. Launch the app — it starts minimized to the system tray (no visible window)
2. Press `Ctrl+Shift+Space` (or `Cmd+Shift+Space` on Mac) — a small frameless popup appears centered on screen
3. Press the shortcut again — the popup hides
4. Right-click the tray icon — context menu appears with Open / Settings / Quit
5. Click outside the popup — it hides (blur behavior)
6. Only one instance of the app can run at a time

## Files Created / Modified

```
electron/tray/trayManager.ts        (new)
electron/windows/chatWindow.ts      (new)
electron/shortcuts.ts               (new, or inline in main.ts)
electron/ipc/handlers.ts            (new)
electron/preload.ts                 (updated — new IPC methods)
electron/main.ts                    (updated — tray, shortcut, window management)
```
