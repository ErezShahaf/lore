# Phase 8 — Polish, Packaging & Distribution

## Goal

Final polish on UX, animations, error handling, testing, and packaging. By the end of this phase, `npm run build` produces production-ready installers for Windows and macOS, the app auto-starts on login, and everything works smoothly end-to-end.

## Prerequisites

- Phase 1–7 complete (all features implemented)

## Steps

### 8.1 UI polish and animations

**Chat popup animations:**
- Smooth height transitions when the window expands/contracts (CSS transitions + Electron `setBounds`)
- Message fade-in animation (CSS `@keyframes` or Framer Motion)
- Typing indicator animation (pulsing dots)
- Subtle entrance animation when the popup appears (scale + fade)

**Visual refinements:**
- Ensure the transparent/blur effect works correctly on both Windows and macOS
  - Windows: may need `win.setBackgroundMaterial('acrylic')` on Windows 11+ or manual workaround
  - macOS: `vibrancy: 'under-window'` on the BrowserWindow
- Smooth scrolling in the message list
- Loading states for all async operations
- Empty states (first-time user with no stored thoughts)

**Input bar polish:**
- Auto-focus when popup appears
- Clear button (X icon) to clear the input
- Visual feedback when submitting (brief flash or animation)
- Character count or subtle size limit indicator (if relevant)

### 8.2 Error handling and edge cases

**Global error handling:**
- Catch unhandled exceptions and rejections in both main and renderer
- Log errors to a file in the user data directory
- Show user-friendly error messages in the UI (never raw stack traces)

**Specific scenarios:**
- Ollama crashes mid-response → show "Connection lost" with retry button
- LanceDB corruption → detect and offer to rebuild the index
- Embedding model changes → re-embed all existing documents (with progress)
- Disk full → graceful message
- Invalid model name during pull → clear error message

**Graceful degradation:**
- If Ollama is not running, still allow opening the popup with a helpful message
- If the database is empty, show a welcoming first-run message
- If a model is downloading, show progress and queue any messages

### 8.3 Testing setup

**Unit tests (Vitest):**
- Test the classifier service with various inputs
- Test the document pipeline (mock LanceDB)
- Test date extraction logic
- Test the adaptive retrieval threshold algorithm
- Test settings persistence

**Integration tests:**
- Test the full flow: classify → handle → store → retrieve
- Test IPC communication between main and renderer
- Test Ollama service with a mock HTTP server

**E2E tests (Playwright or Spectron):**
- Launch the app → verify tray icon appears
- Toggle shortcut → verify popup appears/hides
- Send a message → verify response appears
- Open settings → verify model list loads

Add to `package.json`:
```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test"
  }
}
```

### 8.4 Auto-start on login

`electron/services/autoStartService.ts`:
- Use `app.setLoginItemSettings()` to register/unregister auto-start
- Read the setting from settings service
- On Windows: this adds a registry entry to run the app at login
- On macOS: this adds the app to Login Items

Wire up to the settings UI toggle in General Settings.

### 8.5 electron-builder configuration (finalize)

`electron-builder.json5`:

```json5
{
  "$schema": "https://raw.githubusercontent.com/electron-userland/electron-builder/master/packages/app-builder-lib/scheme.json",
  "appId": "com.lore.app",
  "productName": "Lore",
  "directories": {
    "output": "release/${version}"
  },
  "files": [
    "dist-electron/**/*",
    "dist/**/*"
  ],
  "win": {
    "target": ["nsis"],
    "icon": "resources/icon.ico",
    "artifactName": "${productName}-${version}-Setup.${ext}"
  },
  "nsis": {
    "oneClick": true,
    "perMachine": false,
    "allowToChangeInstallationDirectory": false,
    "deleteAppDataOnUninstall": false,
    "createDesktopShortcut": true,
    "createStartMenuShortcut": true
  },
  "mac": {
    "target": ["dmg"],
    "icon": "resources/icon.icns",
    "category": "public.app-category.productivity",
    "hardenedRuntime": true,
    "gatekeeperAssess": false,
    "entitlements": "build/entitlements.mac.plist",
    "entitlementsInherit": "build/entitlements.mac.plist",
    "artifactName": "${productName}-${version}.${ext}"
  },
  "dmg": {
    "contents": [
      { "x": 130, "y": 220 },
      { "x": 410, "y": 220, "type": "link", "path": "/Applications" }
    ]
  },
  "linux": {
    "target": ["AppImage"],
    "icon": "resources/icon.png",
    "category": "Utility"
  }
}
```

### 8.6 macOS entitlements

`build/entitlements.mac.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.network.client</key>
  <true/>
</dict>
</plist>
```

### 8.7 App icons

Ensure icon files exist in `resources/`:
- `icon.png` — 512×512 PNG (Linux, base)
- `icon.ico` — Windows multi-size ICO (16, 32, 48, 64, 128, 256)
- `icon.icns` — macOS icon set

If the project already has an `icon.png` in the repo root, convert it to all formats.

### 8.8 Build scripts (finalize)

Ensure all `package.json` scripts work:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build && electron-builder",
    "build:win": "tsc && vite build && electron-builder --win",
    "build:mac": "tsc && vite build && electron-builder --mac",
    "build:linux": "tsc && vite build && electron-builder --linux",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "lint": "eslint . --ext .ts,.tsx",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

### 8.9 Performance optimization

- **Startup time**: Lazy-load heavy modules (LanceDB, Ollama service) after the window is ready
- **Memory**: Ensure the app uses reasonable memory when idle in the tray (~50-100 MB)
- **Window show/hide speed**: Pre-create the window and just toggle visibility (already done in Phase 2)
- **Embedding cache**: Cache embeddings for recently searched queries to avoid re-computing

### 8.10 Security review

- `contextIsolation: true` ✓
- `nodeIntegration: false` ✓
- `sandbox: true` (if possible with the current dependencies)
- No remote content loaded
- CSP headers in `index.html`
- All IPC channels validate their inputs
- No secrets stored in code (Ollama is local, no API keys needed for core functionality)

### 8.11 Documentation

Update `README.md` with:
- Project description
- Installation instructions (download installer or build from source)
- Prerequisites (Ollama installation)
- Usage guide (shortcut, storing thoughts, asking questions)
- Settings overview
- Development setup (clone, install, dev, build)
- Architecture overview (high-level)

## Verification

1. `npm run build:win` → produces a `.exe` installer in `release/`
2. `npm run build:mac` → produces a `.dmg` in `release/`
3. Install on Windows → app starts, appears in system tray, shortcut works
4. Install on macOS → app starts, appears in menu bar, shortcut works
5. Enable "Start on login" → app launches after reboot
6. Full flow: store thoughts → ask questions → get RAG answers → manage todos
7. All tests pass: `npm run test`
8. No TypeScript errors: `npm run typecheck`
9. No lint errors: `npm run lint`

## Files Created / Modified

```
electron-builder.json5                  (finalized)
build/entitlements.mac.plist            (new)
resources/icon.ico                      (new — converted from icon.png)
resources/icon.icns                     (new — converted from icon.png)
resources/icon.png                      (moved/copied from repo root)
electron/services/autoStartService.ts   (new)
src/components/chat/ChatWindow.tsx      (updated — animations)
src/components/chat/MessageBubble.tsx   (updated — animations)
src/components/chat/InputBar.tsx        (updated — polish)
package.json                            (updated — finalized scripts)
README.md                              (updated — full documentation)
index.html                             (updated — CSP headers)
```
