# Phase 4 — Local LLM Integration (Ollama)

## Goal

Integrate Ollama as the local LLM backend. The app should detect whether Ollama is installed and running, allow users to pull models from the settings UI, and stream LLM responses back to the chat popup. All inference runs locally — no cloud API calls.

## Prerequisites

- Phase 1–3 complete (working UI with chat and settings windows)

## Why Ollama

Ollama provides:
- Simple HTTP API for chat completions (OpenAI-compatible)
- Built-in model management (pull, list, delete)
- GPU acceleration out of the box
- Cross-platform (Windows, macOS, Linux)
- Runs as a background service

The user must install Ollama separately (or we detect and prompt them). Lore communicates with Ollama via its local HTTP API (default: `http://localhost:11434`).

## Steps

### 4.1 Ollama service layer

`electron/services/ollamaService.ts`:

A service class/module that wraps the Ollama HTTP API:

**Connection management:**
- `checkConnection(): Promise<boolean>` — pings `GET /api/tags` to verify Ollama is running
- `getOllamaHost(): string` — returns the configured host (default `http://localhost:11434`), read from settings
- Periodic health check (every 30 seconds) to update connection status

**Model management:**
- `listModels(): Promise<OllamaModel[]>` — calls `GET /api/tags`, returns installed models with name, size, modified date
- `pullModel(modelName: string, onProgress: (progress: PullProgress) => void): Promise<void>` — calls `POST /api/pull` with streaming progress updates
- `deleteModel(modelName: string): Promise<void>` — calls `DELETE /api/delete`
- `getModelInfo(modelName: string): Promise<ModelInfo>` — calls `POST /api/show`

**Chat completion:**
- `chat(request: ChatRequest): AsyncGenerator<string>` — calls `POST /api/chat` with `stream: true`, yields response chunks
- `generateStructuredResponse(prompt: string, schema: object): Promise<object>` — calls `POST /api/chat` with `format: "json"` for structured JSON output (used by the classifier in Phase 6)

**Types:**
```typescript
interface OllamaModel {
  name: string;
  modifiedAt: string;
  size: number;
  digest: string;
}

interface ChatRequest {
  model: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  stream: boolean;
  format?: 'json';
}

interface PullProgress {
  status: string;
  digest?: string;
  total?: number;
  completed?: number;
}
```

### 4.2 Recommended default models

The app should suggest lightweight models that work well on consumer hardware:

| Purpose    | Model                  | Size   | Notes                           |
| ---------- | ---------------------- | ------ | ------------------------------- |
| Chat/Agent | `llama3.2:3b`          | ~2 GB  | Good balance of speed & quality |
| Chat/Agent | `mistral:7b`           | ~4 GB  | Higher quality, needs more RAM  |
| Embedding  | `nomic-embed-text`     | ~274 MB| Fast, high-quality embeddings   |

Store these as suggested models in the settings UI. The user can also enter any Ollama model name manually.

### 4.3 Wire up chat flow

Update the chat IPC handler (`electron/ipc/handlers.ts`) to:

1. Receive `chat:send` from the renderer
2. Build the message array (system prompt + user message)
3. Call `ollamaService.chat()` with streaming enabled
4. For each chunk yielded, send `chat:response-chunk` to the renderer
5. When the generator completes, send `chat:response-end`
6. Handle errors (Ollama not running, model not found) and send error messages back

System prompt (initial, will be refined in Phase 6):
```
You are Lore, a personal knowledge assistant. You help the user capture thoughts and answer questions about their stored knowledge. Be concise and helpful.
```

### 4.4 Streaming in the renderer

Update `src/hooks/useChat.ts`:
- When `sendMessage` is called:
  1. Add the user message to the messages array
  2. Add a placeholder assistant message with empty content and `isStreaming: true`
  3. Listen for `chat:response-chunk` events, appending each chunk to the assistant message
  4. On `chat:response-end`, set `isStreaming: false`
- Update `MessageBubble` to show a typing cursor/animation while `isStreaming` is true

### 4.5 Settings UI — Model management

Update `src/components/settings/ModelSettings.tsx`:

- **Ollama status indicator**: green dot if connected, red if not, with the host URL
- **Installed models list**: show name, size, with a delete button for each
- **Pull new model**: text input + "Download" button
  - Show download progress bar while pulling
  - Show error if model name is invalid
- **Select active model**: dropdown of installed models
  - Separate dropdowns for chat model and embedding model
- **Ollama host configuration**: text input to change the host URL (default `localhost:11434`)

IPC channels for model management:
- `ollama:status` — get connection status
- `ollama:list-models` — get installed models
- `ollama:pull-model` — start pulling a model (streams progress back)
- `ollama:pull-progress` — progress updates during pull
- `ollama:delete-model` — delete a model
- `ollama:select-model` — set the active chat model
- `ollama:select-embedding-model` — set the active embedding model

### 4.6 First-run experience

When the app launches for the first time (no settings file exists):

1. Detect if Ollama is running
2. If not: show a message in the chat popup or settings directing the user to install Ollama from https://ollama.com
3. If Ollama is running but no model is installed: prompt the user to download a recommended model
4. Once a model is available, the app is ready to use

This can be a simple conditional check in the main process that sends a status to the renderer on startup.

### 4.7 Error handling

Common error scenarios to handle gracefully:
- Ollama not installed or not running → show clear message with install link
- Model not found → suggest pulling it
- Ollama crashes mid-response → show error in chat, allow retry
- Network timeout → retry with backoff
- Insufficient RAM/VRAM for model → show warning suggesting a smaller model

## IPC Channels Introduced

| Channel                     | Direction        | Payload                        | Purpose                          |
| --------------------------- | ---------------- | ------------------------------ | -------------------------------- |
| `ollama:status`             | Renderer → Main  | none                           | Check Ollama connection status   |
| `ollama:status-result`      | Main → Renderer  | `{ connected: boolean }`       | Return connection status         |
| `ollama:list-models`        | Renderer → Main  | none                           | List installed models            |
| `ollama:models-list`        | Main → Renderer  | `OllamaModel[]`               | Return model list                |
| `ollama:pull-model`         | Renderer → Main  | `{ name: string }`            | Start pulling a model            |
| `ollama:pull-progress`      | Main → Renderer  | `PullProgress`                 | Stream pull progress             |
| `ollama:delete-model`       | Renderer → Main  | `{ name: string }`            | Delete a model                   |

## Verification

1. Start the app with Ollama running → status shows green "Connected"
2. Type a message in the chat popup → response streams back word by word
3. Open Settings → Model tab shows installed models
4. Pull a new model → progress bar shows download progress
5. Switch active model → next chat message uses the new model
6. Stop Ollama → status turns red, chat shows "Ollama is not running" message
7. Start Ollama again → status recovers automatically

## Files Created / Modified

```
electron/services/ollamaService.ts       (new)
electron/ipc/handlers.ts                (updated — chat + ollama handlers)
electron/preload.ts                      (updated — ollama IPC methods)
src/hooks/useChat.ts                     (updated — streaming support)
src/components/chat/MessageBubble.tsx    (updated — streaming indicator)
src/components/settings/ModelSettings.tsx (updated — full model management UI)
shared/types.ts                          (updated — Ollama types)
```
