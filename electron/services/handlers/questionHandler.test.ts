import { describe, expect, it } from 'vitest'
import { pruneRetrievedDocumentsForAnswer } from './questionContextPruning'
import type { ScoredDocument } from '../../../shared/types'

function doc(overrides: Partial<ScoredDocument>): ScoredDocument {
  return {
    id: overrides.id ?? 'id-1',
    content: overrides.content ?? 'content',
    vector: overrides.vector ?? new Float32Array(),
    type: overrides.type ?? 'obsidian-note',
    createdAt: overrides.createdAt ?? '2026-04-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-04-01T00:00:00.000Z',
    date: overrides.date ?? '2026-04-01',
    tags: overrides.tags ?? '',
    source: overrides.source ?? 'obsidian',
    metadata: overrides.metadata ?? JSON.stringify({ fileName: 'Tug of War' }),
    isDeleted: overrides.isDeleted ?? false,
    score: overrides.score ?? 1,
  }
}

describe('pruneRetrievedDocumentsForAnswer', () => {
  it('keeps only same file docs for title-focused retrieval', () => {
    const docs: ScoredDocument[] = [
      doc({ id: 'a1', score: 1.5, metadata: JSON.stringify({ fileName: 'Tug of War' }) }),
      doc({ id: 'a2', score: 1.49, metadata: JSON.stringify({ fileName: 'Tug of War' }) }),
      doc({ id: 'b1', score: 0.95, metadata: JSON.stringify({ fileName: 'Another Note' }) }),
    ]

    const pruned = pruneRetrievedDocumentsForAnswer(docs, { titleFocused: true })

    expect(pruned.map((item) => item.id)).toEqual(['a1', 'a2'])
  })

  it('drops low relevance docs by score ratio for non-title queries', () => {
    const docs: ScoredDocument[] = [
      doc({ id: 'x1', source: 'lore', type: 'thought', score: 0.9, metadata: '{}' }),
      doc({ id: 'x2', source: 'lore', type: 'thought', score: 0.6, metadata: '{}' }),
      doc({ id: 'x3', source: 'lore', type: 'thought', score: 0.4, metadata: '{}' }),
    ]

    const pruned = pruneRetrievedDocumentsForAnswer(docs, { titleFocused: false })

    expect(pruned.map((item) => item.id)).toEqual(['x1', 'x2'])
  })
})
