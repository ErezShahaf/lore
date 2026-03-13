# Phase 10 — Ollama Auto-Setup, First-Run Experience & Model Readiness Gate

## Goal

Eliminate the requirement for users to manually install Ollama. The app should automatically download and start Ollama on first launch, show progress in the chat window, and block chat input until both a chat model and an embedding model are configured and available.

## Prerequisites

- Phase 1–9 complete

## What Is Ollama

Ollama is a standalone runtime/server that manages and runs local AI models (Llama, Phi, Gemma, Mistral, etc.). It downloads models, stores them on disk, loads them into memory, handles GPU acceleration, and exposes an HTTP API. Lore uses Ollama's API for all AI operations: downloading models, chatting, generating embeddings.

Previously, Lore required users to install Ollama separately — a friction point that breaks the experience for users who don't know what Ollama is.

## Solution

Three interconnected changes:

1. **Auto-download and start Ollama** on first launch using the `electron-ollama` npm package
2. **Show setup progress** in the chat window (Ollama download progress bar)
3. **Gate the chat input** — disable it with a message when either the chat model or embedding model is not available

## Architecture

```
App Startup Flow:
                                                                
  app.whenReady()                                               
       │                                                        
       ├─ registerIpcHandlers()                                 
       ├─ initLanceDB()                                         
       ├─ createChatWindow()                                    
       ├─ createTray() / registerShortcuts()                    
       │                                                        
       ├─ bootstrapOllama()  ◄── NEW                            
       │    ├─ eo.isRunning()?                                  
       │    │   ├─ YES → broadcast 'ready', skip download       
       │    │   └─ NO  → download binary → serve()              
       │    │            └─ broadcast progress events            
       │    └─ on error → broadcast 'error' phase               
       │                                                        
       └─ startHealthCheck()  (polls every 30s as before)       
                                                                
  Chat Window States:                                           
                                                                
  ┌─────────────────────────────────────────────┐               
  │ State A: Setting Up                         │               
  │  "Setting up AI engine..."                  │               
  │  [████████░░░░░░] 45%                       │               
  │  "Downloading Ollama..."                    │               
  │                                             │               
  │  Input: disabled, "AI engine starting..."   │               
  ├─────────────────────────────────────────────┤               
  │ State B: Needs Models                       │               
  │  "Almost there!"                            │               
  │  "Set up a chat model and embedding model"  │               
  │  [ Open Settings ]                          │               
  │                                             │               
  │  Input: disabled, "Set up models..."        │               
  ├─────────────────────────────────────────────┤               
  │ State C: Ready                              │               
  │  Normal chat experience                     │               
  │                                             │               
  │  Input: enabled                             │               
  └─────────────────────────────────────────────┘               
```

## Steps

### 10.1 Install and integrate `electron-ollama`

**Install**: `npm install electron-ollama`

**New file**: `electron/services/ollamaBootstrap.ts`

This service wraps `electron-ollama` and handles the full lifecycle:

- On app startup, check `eo.isRunning()`
- If not running: download the latest Ollama binary (to `app.getPath('userData')`), then call `eo.serve()` to start it
- Broadcast download progress to all renderer windows via a new IPC event `ollama:setup-progress` with `{ phase: 'downloading' | 'starting' | 'ready' | 'error', percent: number, message: string }`
- If Ollama IS already running (user installed it standalone): skip download, proceed directly
- On `app.will-quit`: call `eo.getServer()?.stop()` to cleanly shut down the managed Ollama instance

Key integration point in `electron/main.ts` — call `bootstrapOllama()` after window/tray creation, before `startHealthCheck()`. The health check will naturally pick up the connection once Ollama finishes starting.

**No changes needed** to `electron/services/ollamaService.ts` — the HTTP client code stays the same. `getHost()` already points to `127.0.0.1:11434` which is where `electron-ollama` starts the server.

### 10.2 New IPC channels for setup status

**Modify `electron/preload.ts`** — expose:
- `onSetupProgress(callback)` — listens for `ollama:setup-progress` events (download %, phase)
- `openSettings()` — invokes `settings:open` to open the settings window from the chat

**Modify `shared/types.ts`** — add:
```typescript
export interface OllamaSetupProgress {
  phase: 'downloading' | 'starting' | 'ready' | 'error'
  percent: number
  message: string
}
```

**Modify `electron/ipc/handlers.ts`** — add handler:
```typescript
ipcMain.handle('settings:open', () => {
  createSettingsWindow()
})
```

### 10.3 Model readiness gate in the chat window

**New hook: `src/hooks/useSetupStatus.ts`**

Returns one of three states:
- `{ status: 'setting-up', phase, percent, message }` — Ollama is downloading/starting
- `{ status: 'needs-models', missingChat, missingEmbedding }` — Ollama is running but models aren't configured
- `{ status: 'ready' }` — everything is good, chat is usable

The hook:
- Listens to `onOllamaStatusChange` for Ollama connection status
- Listens to `onSetupProgress` for download/startup progress
- Reads settings via `getSettings()` and `onSettingsChanged` to check if `selectedModel` and `embeddingModel` are set
- Calls `listModels()` to verify the selected models are actually installed

**Modify `src/components/chat/ChatWindow.tsx`** — uses `useSetupStatus()` to render one of three states:

**State A: Ollama downloading/starting** — centered card with:
- "Setting up AI engine..." title
- Progress bar showing download percentage
- Status text (e.g. "Downloading Ollama... 45%", "Starting engine...")
- Input bar is disabled

**State B: Ollama running but models not configured** — centered card with:
- "Almost there!" title
- Description of what's missing (chat model, embedding model, or both)
- "Open Settings" button that calls `window.loreAPI.openSettings()`
- Input bar is disabled with placeholder: "Set up models in Settings to start chatting"

**State C: Everything ready** — normal chat experience, input enabled

**Modify `src/components/chat/InputBar.tsx`** — accept a `disabledReason?: string` prop. When set, it replaces the default placeholder text so the user knows *why* the input is disabled.

### 10.4 Graceful shutdown

**Modify `electron/main.ts`** — in the `will-quit` handler, stop the managed Ollama server:
```typescript
app.on('will-quit', () => {
  unregisterShortcuts()
  destroyTray()
  stopHealthCheck()
  stopOllama()
})
```

## Edge Cases

**Ollama already installed standalone**: `electron-ollama` detects it's already running and skips download. No conflict.

**Download fails (no internet)**: The `error` phase is broadcast. The setup progress card shows the error message. The user can restart the app to retry.

**Ollama crashes mid-session**: The existing health check (30s polling) detects the disconnect and broadcasts `ollama:status-changed`. The chat window reacts accordingly.

**User installs models then returns to chat**: The `useSetupStatus` hook listens for `settings:changed` events and re-checks model availability whenever settings update.

**App quit**: The managed Ollama process is stopped via `eo.getServer()?.stop()` in the `will-quit` handler.

## Verification

1. Fresh install (no Ollama on system) → app starts → chat shows "Setting up AI engine..." with progress bar → Ollama downloads and starts → chat shows "set up models" message
2. Ollama already installed and running → app skips download, goes straight to model check
3. No models configured → chat input disabled with "Open Settings" button → user configures models → chat becomes usable
4. Both models configured and installed → chat works normally
5. App quit → managed Ollama process stops cleanly
6. Ollama crashes mid-session → health check detects disconnect → chat shows appropriate message

## Files Created / Modified

```
electron/services/ollamaBootstrap.ts        (new — electron-ollama integration)
electron/main.ts                            (modified — call bootstrap on startup, stop on quit)
electron/preload.ts                         (modified — onSetupProgress, openSettings)
electron/ipc/handlers.ts                    (modified — settings:open handler)
shared/types.ts                             (modified — OllamaSetupProgress type)
src/components/chat/ChatWindow.tsx          (modified — setup status UI, model gate)
src/components/chat/InputBar.tsx            (modified — disabledReason prop)
src/hooks/useSetupStatus.ts                 (new — hook for setup + model readiness)
```
