import { describe, expect, it } from 'vitest'
import { extractLiteralSearchNeedles } from './needleExtraction'

describe('extractLiteralSearchNeedles', () => {
  it('keeps content words like curl and stripe', () => {
    const needles = extractLiteralSearchNeedles('give me that curl that goes to stripe')
    const lower = needles.map((needle) => needle.toLowerCase())
    expect(lower).toContain('curl')
    expect(lower).toContain('stripe')
  })

  it('captures urls', () => {
    const needles = extractLiteralSearchNeedles('saved https://api.stripe.com/v1/hooks')
    expect(needles.some((needle) => needle.includes('stripe.com'))).toBe(true)
  })

  it('captures double-quoted phrases', () => {
    const needles = extractLiteralSearchNeedles('find "payment_intent.succeeded" in notes')
    expect(needles.some((needle) => needle.includes('payment_intent'))).toBe(true)
  })
})
