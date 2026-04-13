import pino from 'pino'
import chalk from 'chalk'

const isDev = process.env.NODE_ENV !== 'production'

export const logger = pino({
  level: isDev ? 'debug' : 'silent',
})

const isVerbose = process.argv.includes('--verbose') || process.env.LORE_VERBOSE === 'true' || process.env.LORE_VERBOSE === '1'

export function logVerboseLlmRequest(payload: any) {
  if (!isVerbose) return
  const color = chalk.hex('#FFA500')
  console.log(color('\n--- LLM REQUEST ---'))
  console.log(color(JSON.stringify(payload, null, 2)))
  console.log(color('-------------------\n'))
}

export function logVerboseLlmResponse(payload: any) {
  if (!isVerbose) return
  const color = chalk.hex('#FFA500')
  const content = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2)
  console.log(color('\n--- LLM RESPONSE ---'))
  console.log(color(content))
  console.log(color('--------------------\n'))
}

export function logVerboseRetrieval(query: string, docs: any[]) {
  if (!isVerbose) return
  const color = chalk.hex('#A020F0')
  console.log(color(`\n--- RETRIEVED DOCUMENTS for query: "${query}" ---`))
  if (docs.length === 0) {
    console.log(color('  [No documents retrieved]'))
  }
  docs.forEach((doc, idx) => {
    console.log(color(`\n[${idx + 1}] ID: ${doc.id} | Score: ${doc.score?.toFixed(3) ?? 'N/A'}`))
    console.log(color(`    Tags: ${doc.tags || 'none'} | Source: ${doc.source || 'lore'}`))
    console.log(color(`    Content: ${doc.content}`))
  })
  console.log(color('---------------------------------------------------\n'))
}
