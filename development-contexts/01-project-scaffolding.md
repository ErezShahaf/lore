# Phase 1 — Project Scaffolding & Electron Shell

## Goal

Set up the complete project structure with Electron, TypeScript, React, Vite, Tailwind, and shadcn/ui. By the end of this phase, running `npm run dev` should launch an Electron window rendering a React app with Tailwind styles, and `npm run build` should produce a distributable package.

## Steps

### 1.1 Initialize the project

Create `package.json` with:

- **name**: `lore`
- **version**: `0.1.0`
- **main**: points to the compiled Electron main entry (`dist-electron/main.js`)
- **scripts**:
  - `dev` — runs Vite dev server + Electron concurrently
  - `build` — compiles TypeScript for main/preload, builds renderer with Vite, then runs electron-builder
  - `build:win` — builds Windows installer (NSIS)
  - `build:mac` — builds macOS installer (DMG)
  - `preview` — preview the Vite build locally
  - `typecheck` — runs `tsc --noEmit` on all tsconfigs
  - `lint` — runs ESLint
  - `test` — runs Vitest

### 1.2 Install dependencies

**Runtime dependencies:**
- `react`, `react-dom` (v19)
- `@electron/remote` (if needed, prefer IPC instead)

**Dev dependencies:**
- `electron` (latest stable, 34+)
- `electron-builder`
- `vite`
- `@vitejs/plugin-react`
- `typescript`
- `tailwindcss`, `@tailwindcss/vite`
- `postcss`, `autoprefixer`
- `vite-plugin-electron`, `vite-plugin-electron-renderer`
- `eslint`, `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin`
- `vitest`
- `class-variance-authority`, `clsx`, `tailwind-merge` (for shadcn/ui)
- `lucide-react` (icon library used by shadcn/ui)

### 1.3 TypeScript configuration

Create two tsconfig files:

**`tsconfig.json`** (renderer):
- `strict: true`
- `target: ESNext`, `module: ESNext`
- `jsx: react-jsx`
- `moduleResolution: bundler`
- `paths`: `@/*` → `./src/*`
- `include`: `src/**/*`, `shared/**/*`

**`tsconfig.node.json`** (main/preload):
- `strict: true`
- `target: ESNext`, `module: ESNext`
- `moduleResolution: bundler`
- `include`: `electron/**/*`, `shared/**/*`

### 1.4 Vite configuration

`vite.config.mts`:
- Use `@vitejs/plugin-react`
- Use `vite-plugin-electron` to compile `electron/main.ts` and `electron/preload.ts`
- Configure `vite-plugin-electron-renderer` for renderer process Node.js integration
- Resolve alias: `@` → `./src`

### 1.5 Electron main process skeleton

`electron/main.ts`:
- Create a basic `BrowserWindow`
- Load the Vite dev server URL in development or the built `index.html` in production
- Handle `app.whenReady()`, `window-all-closed`, `activate` lifecycle events
- Enable `contextIsolation: true`, `nodeIntegration: false` in webPreferences
- Set `preload` script path

`electron/preload.ts`:
- Use `contextBridge.exposeInMainWorld` to create a `loreAPI` object
- Expose a placeholder `ping` method to verify IPC works

### 1.6 React app skeleton

`index.html`:
- Standard HTML5 with a `<div id="root">` and a script tag pointing to `src/main.tsx`

`src/main.tsx`:
- Render `<App />` into `#root`

`src/App.tsx`:
- Simple component that renders "Lore" text to confirm everything works

`src/styles/globals.css`:
- Import Tailwind (`@import "tailwindcss"`)
- Add any CSS custom properties for the app theme (dark background, accent colors)

### 1.7 Tailwind & shadcn/ui setup

`tailwind.config.js`:
- Content paths: `./src/**/*.{ts,tsx}`, `./index.html`
- Dark mode: `class`
- Extend theme with Lore brand colors

Initialize shadcn/ui:
- Create `components.json` pointing to `src/components/ui`
- Create the `cn()` utility in `src/lib/utils.ts`
- Install a few base components: `button`, `input`, `card`, `scroll-area`, `dialog`

### 1.8 electron-builder configuration

`electron-builder.json5`:
- `appId`: `com.lore.app`
- `productName`: `Lore`
- `directories.output`: `release`
- `files`: include `dist-electron/**/*` and `dist/**/*`
- `win`: NSIS target, icon path
- `mac`: DMG target, icon path, `hardenedRuntime: true`
- `linux`: AppImage target (optional, nice to have)

### 1.9 ESLint configuration

`.eslintrc.cjs`:
- Extend `@typescript-eslint/recommended`
- Add React hooks plugin
- Rule: `no-explicit-any: error`
- Ignore patterns: `dist`, `dist-electron`, `release`, `node_modules`

### 1.10 Gitignore updates

Ensure `.gitignore` covers:
- `node_modules/`
- `dist/`
- `dist-electron/`
- `release/`
- `.env`

## Verification

After this phase is complete, you should be able to:

1. `npm install` — installs all deps without errors
2. `npm run dev` — opens an Electron window showing the React app with Tailwind styling
3. `npm run build` — produces a working installer in the `release/` directory
4. `npm run typecheck` — passes with zero errors
5. `npm run lint` — passes with zero errors

## Files Created / Modified

```
package.json
tsconfig.json
tsconfig.node.json
vite.config.mts
electron-builder.json5
tailwind.config.js
postcss.config.js
.eslintrc.cjs
.gitignore
index.html
components.json
electron/main.ts
electron/preload.ts
src/main.tsx
src/App.tsx
src/styles/globals.css
src/lib/utils.ts
src/components/ui/button.tsx   (shadcn)
src/components/ui/input.tsx    (shadcn)
src/components/ui/card.tsx     (shadcn)
src/components/ui/scroll-area.tsx (shadcn)
shared/types.ts
```
