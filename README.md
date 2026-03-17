<p align="center">
  <img src="https://github.com/ErezShahaf/lore/blob/main/icon.png?raw=true" width="80" height="80" />
</p>

<h1 align="center">Lore</h1>

<p align="center">
  AI-powered thought capture and recall — runs entirely on your machine.
</p>

<p align="center">
  <a href="https://discord.gg/hsrsertbdb">
    <img src="https://img.shields.io/badge/Discord-Join%20Server-5865F2?logo=discord&logoColor=white" alt="Discord" />
  </a>
  <a href="https://github.com/ErezShahaf/Lore">
    <img src="https://img.shields.io/github/stars/ErezShahaf/Lore?style=flat&logo=github&label=Stars" alt="GitHub Stars" />
  </a>
</p>

<p align="center">
  <img src="readme-query-demo.gif" width="500"/>
</p>


## What is Lore?

Lore is a lightweight desktop app that sits in your system tray and lets you pop-up a hover chat with a button click to quickly capture thoughts. It uses a local LLM (via [Ollama](https://ollama.com)) and a local vector database (LanceDB) to store, understand, and retrieve your information — no cloud services, no API keys, complete privacy.

Think of it as your private second memory — a place to store anything you might need later. From long-form guides you’ve written for yourself, todo lists, decision summaries, urls, or even that exact curl you used to reproduce the bug in production. Everything stays organized and instantly searchable by simply describing it in plain language — even by date, or topic.

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

### Install the Software
You’ll be prompted to choose directories for your LLM models and for Ollama.

### Choose Your Models
After installation, open the settings by clicking the Lore icon in the system tray → Settings.
Navigate to Models, then download both an embedding model and an LLM.
For best performance, follow Lore’s recommendations based on your system.

### Global shortcut

Press **Ctrl+Shift+Space** (or **Cmd+Shift+Space** on macOS) to toggle the Lore popup.

### Storing thoughts

Just type naturally:

- *"Daily note - sarah needs help with feature implementation"*
- *"The stripe webhook event that caused our refund bug {schawarma: true}"*
- *"add to my todo "talk to Daniel about the integration tomorrow"*
- *"todos:  buy milk on the way home, and jump 12 times"*

Lore classifies and stores your input automatically.

### Asking questions

- *"What notes did I write at daily today"*
- *"I'm about to go home, is there anything I need to do on the way home?"*
- *"what was the stripe webhook event that caused our bug?"*
- *"what's on my todo list?"*

Lore searches your stored thoughts and generates an answer with relevant context.

### Managing existing data

- *"My task about jumping 12 times is complete"*
- *"I purchased the milk you can remove it from the todos"*
- *"turns out daniel is on holiday, so change the todo we will meet him in the 4th"*

 ### Setting regular instructions
 - *"From now on, when I ask for my to do list, show the items in bullets, and add an emoji for each one."
 - *"Always end a response by listing the original content & dates of the rows in the database which helped you give me this information."
 - *"Start each conversation by calling me ."

  ### Getting help
 - *What can you do?"
 - *"Wassup my brotha Lore, tell me what u can do or I uninstall"

### Settings

Right-click the tray icon and select **Settings**, or access settings to:

- Change the global keyboard shortcut
- Select chat and embedding models
- Pull or delete Ollama models
- Enable/disable start on login
## Community

Join the [Lore Discord server](https://discord.gg/hsrsertbdb) to share feedback, ask questions, and connect with other users.

<a href="https://discord.gg/hsrsertbdb">
  <img src="https://www.vectorlogo.zone/logos/discord/discord-icon.svg" width="40" alt="Discord" />
</a>

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
