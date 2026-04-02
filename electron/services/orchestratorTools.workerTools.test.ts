import { describe, expect, it } from 'vitest'
import { getOllamaToolsForWorker } from './orchestratorTools'

describe('getOllamaToolsForWorker', () => {
  it('limits question worker to search_for_question and get_document', () => {
    const names = getOllamaToolsForWorker('question').map((tool) => tool.function.name).sort()
    expect(names).toEqual(['get_document', 'search_for_question'])
  })

  it('includes compose_reply for thought worker', () => {
    const names = getOllamaToolsForWorker('thought').map((tool) => tool.function.name).sort()
    expect(names).toEqual(['compose_reply', 'get_document', 'save_documents'])
  })

  it('returns no tools for conversational worker', () => {
    expect(getOllamaToolsForWorker('conversational')).toEqual([])
  })
})
