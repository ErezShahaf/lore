import { existsSync, readFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig } from 'vite'

const viewerRoot = fileURLToPath(new URL('.', import.meta.url))
const repositoryRoot = resolve(viewerRoot, '../..')
const evalResultsDirectory = join(repositoryRoot, 'evals', 'results')

function isResolvedPathInsideDirectory(filePath: string, directoryPath: string): boolean {
  const resolvedFile = resolve(filePath)
  const resolvedDirectory = resolve(directoryPath)
  return (
    resolvedFile === resolvedDirectory
    || resolvedFile.startsWith(resolvedDirectory.endsWith(sep) ? resolvedDirectory : resolvedDirectory + sep)
  )
}

function evalResultsMiddleware() {
  return (
    request: IncomingMessage,
    response: ServerResponse,
    next: () => void,
  ): void => {
    const requestUrl = request.url ?? ''
    const pathname = requestUrl.split('?')[0] ?? ''
    const prefix = '/evals/results/'
    if (!pathname.startsWith(prefix)) {
      next()
      return
    }

    const encodedName = pathname.slice(prefix.length)
    if (encodedName.length === 0) {
      response.statusCode = 400
      response.end('Missing file name')
      return
    }

    const decodedName = decodeURIComponent(encodedName)
    if (decodedName.includes('..') || decodedName.includes('/') || decodedName.includes('\\')) {
      response.statusCode = 400
      response.end('Invalid path')
      return
    }

    const absolutePath = join(evalResultsDirectory, decodedName)
    if (!isResolvedPathInsideDirectory(absolutePath, evalResultsDirectory)) {
      response.statusCode = 403
      response.end('Forbidden')
      return
    }

    if (!existsSync(absolutePath)) {
      response.statusCode = 404
      response.end('Not found')
      return
    }

    const buffer = readFileSync(absolutePath)
    response.setHeader('Content-Type', 'application/json')
    response.setHeader('Cache-Control', 'no-store')
    response.end(buffer)
  }
}

export default defineConfig({
  root: viewerRoot,
  plugins: [
    react(),
    {
      name: 'lore-eval-results-static',
      configureServer(server) {
        server.middlewares.use(evalResultsMiddleware())
      },
    },
  ],
  server: {
    port: 5180,
    strictPort: false,
    fs: {
      allow: [repositoryRoot],
    },
  },
  build: {
    outDir: resolve(viewerRoot, 'dist'),
    emptyOutDir: true,
  },
})
