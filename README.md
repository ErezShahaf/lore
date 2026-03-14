ר<p align="center">
  <img src="https://github.com/ErezShahaf/lore/blob/main/icon.png?raw=true" width="80" height="80" />
</p>

<h1 align="center">Lore</h1>

<p align="center">
  AI-powered thought capture and recall — runs entirely on your machine.

  <img src="readme-query-demo.gif" width="500"/>
</p>


## What is Lore?

Lore is a lightweight desktop app that sits in your system tray and lets you pop-up a hover chat with a button click to quickly capture thoughts, notes, and todos using natural language. It uses a local LLM (via [Ollama](https://ollama.com)) and a local vector database (LanceDB) to store, understand, and retrieve your information — no cloud services, no API keys, complete privacy.

### Key features

- **Quick capture** — press a global shortcut to pop up a chat bar, type a thought, and it's stored instantly
- **Smart recall** — ask questions in natural language and get answers sourced from your stored thoughts
- **AI classification** — input is automatically classified as a thought, question, command, or instruction
- **Todo management** — add, list, complete, and organize todos with priority and categories
- **RAG pipeline** — retrieval-augmented generation finds relevant context from your notes before answering
- **Fully local** — all data and AI processing stays on your machine

## Installation

### Download installer

Download the latest release from the [Releases](https://github.com/ErezShahaf/lore/releases) page:

- **Windows** — `Lore-x.x.x-Setup.exe`
- **macOS** — `Lore-x.x.x.dmg`
- **Linux** — `Lore-x.x.x.AppImage`

### Build from source

```bash
git clone https://github.com/ErezShahaf/lore.git
cd lore
npm install
npm run build
```

Installers will appear in `release/<version>/`.

## Usage

### Global shortcut

Press **Ctrl+Shift+Space** (or **Cmd+Shift+Space** on macOS) to toggle the Lore popup.

### Storing thoughts

Just type naturally:

- *"Daily note - sarah needs help with feature implementation"*
- *"todo remember to buy milk on the way home"*
- *"The stripe webhook event that caused our refund bug {schawarma: true}"*
- *"add to my todo "talk to Daniel about the integration tomorrow"*

Lore classifies and stores your input automatically.

### Asking questions

- *"What notes did I write at daily today"*
- *"I'm about to go home, is there anything I need to do on the way home?"*
- *"what was the stripe webhook event that caused our bug?"*
- *"what's on my todo list?"*

Lore searches your stored thoughts and generates an answer with relevant context.

### Managing existing data

- *"remove from todo the note about speaking to daniel"*
- *"I purchased the milk you can remove that note"*
- *"turns out daniel is on holiday, so change the todo we will meet him in the 4th"*

 ### Setting regular instructions
 - *"When I ask for my to do list, show the items in bullets."
 - *"Always end a response by listing the original content & dates of the rows in the database which helped you give me this information."
 - *"when you give me a list of todos include an emoji for each item."

### Settings

Right-click the tray icon and select **Settings**, or access settings to:

- Change the global keyboard shortcut
- Select chat and embedding models
- Pull or delete Ollama models
- Enable/disable start on login
## Star History

<a href="https://www.star-history.com/?repos=ErezShahaf%2FLore&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/image?repos=ErezShahaf/Lore&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/image?repos=ErezShahaf/Lore&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/image?repos=ErezShahaf/Lore&type=date&legend=top-left" />
 </picture>
</a>

## Development

### Setup

```bash
git clone https://github.com/ErezShahaf/lore.git
cd lore
npm install
```

### Run in development

```bash
npm run dev
```

### Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Vite dev server with Electron |
| `npm run build` | Typecheck + build + package for current platform |
| `npm run build:win` | Build Windows installer (.exe) |
| `npm run build:mac` | Build macOS installer (.dmg) |
| `npm run build:linux` | Build Linux AppImage |
| `npm run typecheck` | Run TypeScript type checking |
| `npm run lint` | Run ESLint |
| `npm test` | Run unit tests (Vitest) |
| `npm run test:watch` | Run tests in watch mode |



## License

[MIT](LICENSE)
