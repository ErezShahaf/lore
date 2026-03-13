# Phase 3 — UI: Chat Interface & Settings

## Goal

Build the spotlight-style chat popup UI and the settings window UI. The chat popup should feel like a sleek command palette — minimal, semi-transparent, with smooth height animations when responses appear. The settings window is a separate, standard window for configuration.

## Prerequisites

- Phase 1 complete (React + Tailwind + shadcn/ui)
- Phase 2 complete (chat window and settings window management in Electron)

## Design Language

- **Dark theme by default** with subtle background opacity/blur
- **Rounded corners** on the popup window
- **Monospace or clean sans-serif font** for input
- **Subtle animations**: height expansion, message fade-in
- **Color palette**: dark grays (#0a0a0a, #1a1a1a, #2a2a2a), accent color (soft blue #3b82f6 or violet #8b5cf6), text white/gray
- **No window chrome** — the popup is fully custom-drawn

## Steps

### 3.1 App routing by window type

The same React app serves both the chat popup and the settings window. Differentiate them via a query parameter in the URL loaded by Electron.

`src/App.tsx`:
- Read `window.location.search` or `window.location.hash` to determine the window type
- Render `<ChatWindow />` for the popup, `<SettingsWindow />` for settings

### 3.2 Chat popup UI

`src/components/chat/ChatWindow.tsx`:

The main chat popup container:
- Full-window container with rounded corners, semi-transparent dark background
- Uses CSS `backdrop-filter: blur()` for the glass effect (if the OS and Electron support it)
- Contains two sections:
  1. **Input area** (always visible at the bottom)
  2. **Messages area** (appears above input when there are messages, scrollable)

Layout (collapsed — no messages):
```
┌──────────────────────────────────────────┐
│  [icon]  Type a thought or ask...    [⏎] │
└──────────────────────────────────────────┘
```

Layout (expanded — with messages):
```
┌──────────────────────────────────────────┐
│                                          │
│   ┌─ User ──────────────────────────┐    │
│   │ What were my notes from today?  │    │
│   └─────────────────────────────────┘    │
│                                          │
│   ┌─ Lore ──────────────────────────┐    │
│   │ Here are your notes from today: │    │
│   │ • Meeting with design team...   │    │
│   │ • Idea about caching layer...   │    │
│   └─────────────────────────────────┘    │
│                                          │
│  [icon]  Type a thought or ask...    [⏎] │
└──────────────────────────────────────────┘
```

`src/components/chat/InputBar.tsx`:
- A text input (or textarea for multiline) with auto-focus
- Placeholder: "Type a thought or ask a question..."
- Submit on Enter (Shift+Enter for newline if textarea)
- Send button (or just Enter key)
- When the popup appears, the input is automatically focused
- Escape key hides the popup (calls `loreAPI.hideChatWindow()`)

`src/components/chat/MessageBubble.tsx`:
- Renders a single message (user or assistant)
- Different styling for user vs assistant messages
- User messages: right-aligned or subtle background
- Assistant messages: left-aligned, slightly different background
- Support for markdown rendering in assistant messages (use a lightweight markdown renderer)
- Typing indicator animation for streaming responses

`src/components/chat/MessageList.tsx`:
- Renders the list of messages
- Auto-scrolls to the bottom when new messages arrive
- Uses shadcn `ScrollArea` for smooth scrolling

### 3.3 Window height animation

When messages appear or the content changes, the chat popup should smoothly animate its height:

`src/hooks/useWindowResize.ts`:
- Monitor the content height of the messages area
- Use `ResizeObserver` on the content container
- Calculate the desired window height: input bar height + messages content height + padding
- Clamp to a max height (e.g., 500px — roughly 60% of typical screen)
- Call `loreAPI.resizeChatWindow(newHeight)` via IPC
- On the Electron side, animate the height change (use `setBounds` with small increments or CSS transitions)

### 3.4 Chat state management

`src/hooks/useChat.ts`:
- Manages the messages array: `Array<{ role: 'user' | 'assistant'; content: string; timestamp: Date }>`
- `sendMessage(text: string)` — adds user message, sends to backend via IPC, receives response
- `clearMessages()` — resets the conversation (called when popup is hidden and re-shown)
- `isLoading` state for showing the typing indicator
- Handle streaming responses (append chunks to the current assistant message)

IPC integration:
- `loreAPI.sendMessage(text: string): Promise<string>` — for non-streaming
- `loreAPI.onMessageChunk(callback: (chunk: string) => void)` — for streaming responses
- These are placeholders for now; actual LLM integration comes in Phase 4

### 3.5 Reset on hide

When the popup is hidden:
- Listen for the `chat:reset` IPC event from main process
- Clear messages and reset the input
- Each time the popup opens, it starts fresh (or optionally, keep context within a session — make this configurable later)

### 3.6 Settings window UI

`src/components/settings/SettingsWindow.tsx`:

A standard window with a sidebar navigation and content area:

```
┌──────────────────────────────────────────────────┐
│  Lore Settings                            [✕]    │
├──────────┬───────────────────────────────────────┤
│          │                                       │
│  General │   Model Configuration                 │
│  Model   │                                       │
│  About   │   Current Model: [llama3.2:3b    ▾]   │
│          │                                       │
│          │   [Download New Model]                 │
│          │                                       │
│          │   Status: ● Ollama running             │
│          │                                       │
│          │   Keyboard Shortcut:                   │
│          │   [ Ctrl+Shift+Space ]  [Change]       │
│          │                                       │
│          │   ☑ Start on login                     │
│          │   ☑ Hide on blur                       │
│          │                                       │
└──────────┴───────────────────────────────────────┘
```

Setting sections (implement the UI shells, actual functionality comes in later phases):

**General**:
- Keyboard shortcut configuration
- Start on login toggle
- Hide on blur toggle
- Theme (dark only for now, but build the infrastructure)

**Model**:
- Current model display
- Model selector dropdown
- Download new model input + button
- Ollama connection status indicator
- Embedding model selector

**About**:
- App version
- Links to repo / docs

`src/components/settings/GeneralSettings.tsx`
`src/components/settings/ModelSettings.tsx`
`src/components/settings/AboutSettings.tsx`

### 3.7 Settings persistence

Settings need to persist across app restarts.

`electron/services/settingsService.ts`:
- Use `electron-store` or a simple JSON file in the app's user data directory
- Store settings as a typed object:
  ```typescript
  interface AppSettings {
    shortcut: string;
    startOnLogin: boolean;
    hideOnBlur: boolean;
    selectedModel: string;
    embeddingModel: string;
    ollamaHost: string;
  }
  ```
- Provide `getSettings()` and `updateSettings(partial)` functions
- Expose via IPC to the renderer

### 3.8 Settings window management

`electron/windows/settingsWindow.ts`:
- Standard framed `BrowserWindow`
- Size: ~800×600
- Load the same React app but with `?window=settings` query param
- Only one settings window at a time (reuse if already open)

IPC channels for settings:
- `settings:get` — returns current settings
- `settings:update` — updates and persists settings
- `settings:on-change` — notifies renderer of changes

## IPC Channels Introduced

| Channel              | Direction        | Payload                    | Purpose                          |
| -------------------- | ---------------- | -------------------------- | -------------------------------- |
| `chat:send`          | Renderer → Main  | `{ message: string }`     | Send user message for processing |
| `chat:response`      | Main → Renderer  | `{ content: string }`     | Return response (non-streaming)  |
| `chat:response-chunk`| Main → Renderer  | `{ chunk: string }`       | Stream response chunk            |
| `chat:response-end`  | Main → Renderer  | none                       | Signal end of streaming          |
| `settings:get`       | Renderer → Main  | none                       | Get current settings             |
| `settings:update`    | Renderer → Main  | `Partial<AppSettings>`     | Update settings                  |
| `settings:changed`   | Main → Renderer  | `AppSettings`              | Notify of settings change        |

## Verification

1. Launch app → press shortcut → sleek popup appears centered on screen
2. Type text and press Enter → user message appears, window expands smoothly
3. Mock response appears → assistant bubble renders, window grows to fit
4. Press Escape or click outside → popup hides
5. Re-open popup → previous messages are cleared, input is focused
6. Open Settings from tray → settings window appears with General / Model / About tabs
7. Change a setting → it persists across app restart

## Files Created / Modified

```
src/App.tsx                              (updated — routing)
src/components/chat/ChatWindow.tsx       (new)
src/components/chat/InputBar.tsx         (new)
src/components/chat/MessageBubble.tsx    (new)
src/components/chat/MessageList.tsx      (new)
src/components/settings/SettingsWindow.tsx  (new)
src/components/settings/GeneralSettings.tsx (new)
src/components/settings/ModelSettings.tsx   (new)
src/components/settings/AboutSettings.tsx   (new)
src/hooks/useChat.ts                     (new)
src/hooks/useWindowResize.ts             (new)
src/hooks/useSettings.ts                 (new)
electron/services/settingsService.ts     (new)
electron/windows/settingsWindow.ts       (new)
electron/preload.ts                      (updated — new IPC methods)
electron/ipc/handlers.ts                (updated — new handlers)
shared/types.ts                          (updated — AppSettings, Message types)
```
