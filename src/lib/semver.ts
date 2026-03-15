const SEMVER_REGEX = /^(\d+)\.(\d+)\.(\d+)(?:-[\w.-]+)?(?:\+[\w.-]+)?$/

function parseParts(version: string): [number, number, number] | null {
  const match = version.trim().match(SEMVER_REGEX)
  if (!match) return null
  const major = parseInt(match[1], 10)
  const minor = parseInt(match[2], 10)
  const patch = parseInt(match[3], 10)
  if (Number.isNaN(major) || Number.isNaN(minor) || Number.isNaN(patch)) return null
  return [major, minor, patch]
}

/**
 * Compare two semver strings. Returns 1 if a > b, -1 if a < b, 0 if equal.
 * Returns null if either string is not valid semver.
 */
export function compareSemver(a: string, b: string): 1 | -1 | 0 | null {
  const partsA = parseParts(a)
  const partsB = parseParts(b)
  if (partsA === null || partsB === null) return null
  for (let i = 0; i < 3; i++) {
    if (partsA[i] > partsB[i]) return 1
    if (partsA[i] < partsB[i]) return -1
  }
  return 0
}
