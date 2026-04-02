import { describe, expect, it } from 'vitest'
import { isTodoListingUserIntent } from './todoListingIntent'

describe('isTodoListingUserIntent', () => {
  it('returns true for common todo-list phrasings', () => {
    expect(isTodoListingUserIntent('whats on my todo')).toBe(true)
    expect(isTodoListingUserIntent("what's on my todo")).toBe(true)
    expect(isTodoListingUserIntent('What is on my todos')).toBe(true)
    expect(isTodoListingUserIntent('show my todos')).toBe(true)
    expect(isTodoListingUserIntent('list my tasks')).toBe(true)
    expect(isTodoListingUserIntent('do I have any todos')).toBe(true)
    expect(isTodoListingUserIntent('all my tasks')).toBe(true)
  })

  it('returns false for unrelated or save-style wording', () => {
    expect(isTodoListingUserIntent('')).toBe(false)
    expect(isTodoListingUserIntent('add buy milk to my todos')).toBe(false)
    expect(isTodoListingUserIntent('save this thought about sprint planning')).toBe(false)
    expect(isTodoListingUserIntent('notes about sprint 22')).toBe(false)
  })
})
