/**
 * Heuristic "needles" for literal / substring search over note bodies.
 * Complements vector search; does not replace classifier structured tags.
 */

const STOPWORDS = new Set([
  'give',
  'tell',
  'show',
  'list',
  'what',
  'when',
  'where',
  'which',
  'who',
  'whom',
  'whose',
  'why',
  'how',
  'that',
  'this',
  'these',
  'those',
  'some',
  'any',
  'all',
  'from',
  'with',
  'have',
  'has',
  'had',
  'does',
  'did',
  'doing',
  'done',
  'please',
  'just',
  'only',
  'also',
  'into',
  'about',
  'after',
  'before',
  'above',
  'below',
  'between',
  'under',
  'over',
  'again',
  'then',
  'than',
  'very',
  'here',
  'there',
  'need',
  'wants',
  'went',
  'come',
  'coming',
  'your',
  'mine',
  'their',
  'them',
  'they',
  'were',
  'was',
  'will',
  'would',
  'could',
  'should',
  'might',
  'must',
  'shall',
  'let',
  'make',
  'made',
  'such',
  'each',
  'other',
])

const URL_PATTERN = /\bhttps?:\/\/[^\s]+/gi

function uniquePreserveOrder(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out
}

/**
 * Extract phrases likely to appear verbatim in stored notes (URLs, quotes, content words).
 */
export function extractLiteralSearchNeedles(userText: string): readonly string[] {
  const trimmed = userText.trim()
  if (trimmed.length === 0) return []

  const quoted =
    trimmed.match(/"([^"]+)"|`([^`]+)`|'([^']+)'/g)?.flatMap((match) => {
      const inner = match.slice(1, -1).trim()
      return inner.length >= 2 ? [inner] : []
    }) ?? []

  const urls = trimmed.match(URL_PATTERN) ?? []

  const rawTokens =
    trimmed
      .toLowerCase()
      .replace(URL_PATTERN, ' ')
      .match(/\b[\w][\w.-]*\b/g) ?? []

  const tokens = rawTokens.filter((token) => {
    if (token.length < 3) return false
    if (STOPWORDS.has(token)) return false
    return true
  })

  return uniquePreserveOrder([...quoted, ...urls, ...tokens])
}
