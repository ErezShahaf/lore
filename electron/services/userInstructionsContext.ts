import { retrieveByFilters } from './documentPipeline'
import type { LoreDocument } from '../../shared/types'

export const MAX_USER_INSTRUCTIONS_BLOCK_CHARS = 12000

export async function loadAllUserInstructionDocuments(): Promise<readonly LoreDocument[]> {
  const result = await retrieveByFilters({
    type: 'instruction',
    maxResults: 100,
  })
  return result.documents
}

export function formatUserInstructionsBlock(documents: readonly LoreDocument[]): string {
  if (documents.length === 0) return ''
  const lines = documents.map((document) => `- ${document.content.trim()}`)
  let text = [
    'User standing instructions (apply when relevant; do not contradict skill JSON or schema requirements):',
    ...lines,
  ].join('\n')
  if (text.length > MAX_USER_INSTRUCTIONS_BLOCK_CHARS) {
    text = `${text.slice(0, MAX_USER_INSTRUCTIONS_BLOCK_CHARS)}\n…`
  }
  return text
}

export function appendUserInstructionsToSystemPrompt(
  baseSystemPrompt: string,
  userInstructionsBlock: string,
): string {
  const trimmed = userInstructionsBlock.trim()
  if (trimmed.length === 0) return baseSystemPrompt
  return `${baseSystemPrompt}\n\n---\n\n${trimmed}`
}

export function instructionDocumentsRequestTodoListing(documents: readonly LoreDocument[]): boolean {
  return documents.some((document) => {
    const lower = document.content.toLowerCase()
    return lower.includes('todo') || lower.includes('todos')
  })
}

export function instructionDocumentsRequestRichTodoFormatting(documents: readonly LoreDocument[]): boolean {
  return documents.some((document) => {
    const lower = document.content.toLowerCase()
    return lower.includes('emoji') || lower.includes('emojis')
  })
}
