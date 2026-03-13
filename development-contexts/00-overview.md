# Lore — Development Plan Overview

Lore is an AI-powered thought capture and recall desktop app. It presents a spotlight-style popup window (triggered by a global keyboard shortcut) where users type thoughts to remember or questions to ask. A local LLM classifies, restructures, and stores thoughts in a vector database (LanceDB), and uses RAG to answer questions against the stored corpus.

## Architecture Summary

```
┌─────────────────────────────────────────────────────────┐
│                     Electron Main Process               │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ System Tray  │  │ Global       │  │ Window       │   │
│  │ Manager      │  │ Shortcut     │  │ Manager      │   │
│  └──────────────┘  └──────────────┘  └──────────────┘   │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ Ollama       │  │ LanceDB      │  │ AI Agent     │   │
│  │ Service      │  │ Service      │  │ Pipeline     │   │
│  └──────────────┘  └──────────────┘  └──────────────┘   │
│                                                         │
│  IPC Bridge (contextBridge / ipcMain ↔ ipcRenderer)     │
├─────────────────────────────────────────────────────────┤
│                     Renderer Process                    │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐                     │
│  │ Chat Popup   │  │ Settings     │                     │
│  │ Window (React│  │ Window (React│                     │
│  │ + shadcn/ui) │  │ + shadcn/ui) │                     │
│  └──────────────┘  └──────────────┘                     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Tech Stack

| Layer          | Technology                                      |
| -------------- | ----------------------------------------------- |
| Desktop shell  | Electron 34+                                    |
| Language       | TypeScript (strict mode)                        |
| Frontend       | React 19, Tailwind CSS 4, shadcn/ui             |
| Bundler        | Vite (renderer), tsc (main/preload)              |
| Vector DB      | LanceDB (embedded, local)                       |
| LLM runtime    | Ollama (local, open-source models)              |
| Embeddings     | Ollama embedding models (nomic-embed-text, etc.) |
| Packaging      | electron-builder (NSIS for Windows, DMG for Mac) |

## Development Phases

Implement these in order. Each phase has its own context file with full details.

| #  | Phase                              | Context File                                  |
| -- | ---------------------------------- | --------------------------------------------- |
| 1  | Project Scaffolding & Electron Shell| `01-project-scaffolding.md`                   |
| 2  | System Tray & Global Shortcut      | `02-system-tray-and-shortcut.md`              |
| 3  | UI — Chat Interface & Settings     | `03-ui-chat-and-settings.md`                  |
| 4  | Local LLM Integration (Ollama)     | `04-local-llm-integration.md`                 |
| 5  | Vector Database & Embedding        | `05-vector-database-and-embedding.md`         |
| 6  | AI Agent — Classification & Routing| `06-ai-agent-classification-and-routing.md`   |
| 7  | Smart Features — Dates, Todos      | `07-smart-features-dates-todos.md`            |
| 8  | Polish, Packaging & Distribution   | `08-polish-packaging-distribution.md`         |

## Directory Structure (Target)

```
lore/
├── electron/
│   ├── main.ts                  # Electron main process entry
│   ├── preload.ts               # Context bridge / IPC exposure
│   ├── windows/
│   │   ├── chatWindow.ts        # Spotlight popup window management
│   │   └── settingsWindow.ts    # Settings window management
│   ├── tray/
│   │   └── trayManager.ts       # System tray setup
│   ├── services/
│   │   ├── ollamaService.ts     # Ollama lifecycle and API
│   │   ├── lanceService.ts      # LanceDB read/write/search
│   │   ├── embeddingService.ts  # Text → vector embedding
│   │   └── agentService.ts      # AI classification, routing, RAG
│   └── ipc/
│       └── handlers.ts          # IPC channel handlers
├── src/
│   ├── main.tsx                 # React entry
│   ├── App.tsx                  # Router / window type switch
│   ├── components/
│   │   ├── chat/
│   │   │   ├── ChatWindow.tsx   # Main spotlight chat UI
│   │   │   ├── MessageBubble.tsx
│   │   │   └── InputBar.tsx
│   │   ├── settings/
│   │   │   ├── SettingsWindow.tsx
│   │   │   ├── ModelSelector.tsx
│   │   │   └── GeneralSettings.tsx
│   │   └── ui/                  # shadcn/ui primitives
│   ├── hooks/
│   │   ├── useChat.ts
│   │   ├── useSettings.ts
│   │   └── useWindowResize.ts
│   ├── lib/
│   │   └── ipc.ts               # Typed IPC client helpers
│   └── styles/
│       └── globals.css          # Tailwind base + custom tokens
├── shared/
│   └── types.ts                 # Types shared between main and renderer
├── resources/
│   ├── icon.png
│   ├── icon.ico
│   └── icon.icns
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.mts
├── electron-builder.json5
├── tailwind.config.js
├── postcss.config.js
└── index.html
```

## Key Design Decisions

1. **Two windows, one app**: The chat popup and settings are separate `BrowserWindow` instances. The chat popup is frameless, always-on-top, and appears/disappears via the global shortcut. The settings window is a standard framed window opened from the tray menu.

2. **Ollama as LLM backend**: Rather than bundling llama.cpp directly, Lore relies on Ollama running locally. The app can detect, launch, and manage Ollama, and the settings UI lets users browse and pull models. This keeps the app lean and lets Ollama handle GPU acceleration.

3. **LanceDB embedded**: LanceDB runs in-process (no separate server). The database files live in the user's app data directory. Each stored thought becomes a document with: content, embedding vector, date, type (thought/todo/instruction), and metadata.

4. **Classification-first pipeline**: Every user input goes through a classification step. The LLM returns structured JSON indicating whether the input is a thought, question, command (delete/update), or instruction (preference). Each type routes to a different handler.

5. **Multi-document retrieval**: When answering questions, the agent retrieves multiple documents from LanceDB (not just top-1) and continues retrieving until results fall below a relevance threshold. This ensures complete answers for questions like "show me my todo list" or "what did I discuss today."

6. **Instructions as documents**: User preferences ("show task A higher than task B") are stored as instruction-type documents in the same LanceDB. When retrieving for a query, instructions matching the context are included, allowing the agent to respect user preferences.
