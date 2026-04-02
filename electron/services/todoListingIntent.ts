/**
 * Detects when the user is asking to list or view their stored todos/tasks,
 * independent of classifier `extractedTags`. Used so read/search paths use
 * `type: 'todo'` retrieval instead of hybrid search over all document types.
 */

const todoListingPatterns: readonly RegExp[] = [
  /\bwhat\s*(?:is|'s|’s)\s+(?:on\s+)?(?:my\s+)?(?:todo|todos)\b/i,
  /\bwhats\s+(?:on\s+)?(?:my\s+)?(?:todo|todos)\b/i,
  /\b(?:show|list|display|see|check|give\s+me)\s+(?:my\s+)?(?:todo|todos|tasks)\b/i,
  /\b(?:my\s+)?(?:todo|todos|tasks)\s+(?:list|queue)\b/i,
  /\ball\s+my\s+(?:todos?|tasks)\b/i,
  /\bdo\s+i\s+have\s+(?:any\s+)?(?:open\s+)?(?:todos?|tasks)\b/i,
]

export function isTodoListingUserIntent(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length === 0) {
    return false
  }
  return todoListingPatterns.some((pattern) => pattern.test(trimmed))
}
