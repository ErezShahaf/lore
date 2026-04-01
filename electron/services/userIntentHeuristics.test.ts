import { describe, expect, it } from 'vitest'
import { extractObsidianNoteTitleCandidates } from './userIntentHeuristics'

describe('extractObsidianNoteTitleCandidates', () => {
  it('extracts quoted note title from obsidian query', () => {
    const input = 'Give me the content of my "Tug of war" note from obsidian'
    const candidates = extractObsidianNoteTitleCandidates(input)

    expect(candidates).toContain('Tug of war')
  })

  it('extracts unquoted note title pattern', () => {
    const input = 'show me the content of my Tug Of War note from vault'
    const candidates = extractObsidianNoteTitleCandidates(input)

    expect(candidates).toContain('Tug Of War')
  })

  it('deduplicates equivalent title candidates by case', () => {
    const input = 'find "Tug of war" and "tug of war" note from obsidian'
    const candidates = extractObsidianNoteTitleCandidates(input)

    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toBe('Tug of war')
  })
})