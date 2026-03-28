export function stripJsonCodeFences(text: string): string {
  const trimmed = text.trim()
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (!match) return trimmed
  return match[1].trim()
}

function tryParseObjectOrArrayJson(candidate: string): string | null {
  try {
    const parsed = JSON.parse(candidate) as unknown
    if (typeof parsed !== 'object' || parsed === null) return null
    return candidate
  } catch {
    return null
  }
}

function tryExtractBalancedJsonSlice(text: string, startIndex: number): string | null {
  const openChar = text[startIndex]
  if (openChar !== '{' && openChar !== '[') return null
  const closeChar = openChar === '{' ? '}' : ']'
  let depth = 0
  let inString = false
  let escapeNext = false

  for (let index = startIndex; index < text.length; index += 1) {
    const character = text[index]
    if (inString) {
      if (escapeNext) {
        escapeNext = false
        continue
      }
      if (character === '\\') {
        escapeNext = true
        continue
      }
      if (character === '"') {
        inString = false
      }
      continue
    }
    if (character === '"') {
      inString = true
      continue
    }
    if (character === openChar) depth += 1
    else if (character === closeChar) {
      depth -= 1
      if (depth === 0) {
        const slice = text.slice(startIndex, index + 1)
        return tryParseObjectOrArrayJson(slice)
      }
    }
  }
  return null
}

function tryExtractJsonFromInlineCodeFence(content: string): string | null {
  const fencePattern = /```(?:json)?\s*([\s\S]*?)```/gi
  let match = fencePattern.exec(content)
  while (match !== null) {
    const inner = match[1].trim()
    const parsed = tryParseObjectOrArrayJson(inner)
    if (parsed !== null) return parsed
    match = fencePattern.exec(content)
  }
  return null
}

/**
 * Returns a JSON object/array substring from user or stored note text when one is present
 * (whole message, fenced block, or embedded after prose such as a title line).
 */
export function tryExtractEmbeddedJsonPayload(text: string): string | null {
  const fromFence = tryExtractJsonFromInlineCodeFence(text)
  if (fromFence !== null) return fromFence

  const trimmed = text.trim()
  const wholeAfterOuterFence = stripJsonCodeFences(trimmed)
  const wholeCandidate = tryParseObjectOrArrayJson(wholeAfterOuterFence)
  if (wholeCandidate !== null) return wholeCandidate

  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index]
    if (character !== '{' && character !== '[') continue
    const extracted = tryExtractBalancedJsonSlice(trimmed, index)
    if (extracted !== null) return extracted
  }

  return null
}

export function tryParseJsonBlob(text: string): string | null {
  const candidate = stripJsonCodeFences(text.trim())
  return tryParseObjectOrArrayJson(candidate)
}

export function noteContainsStructuredPayload(content: string): boolean {
  return tryExtractEmbeddedJsonPayload(content) !== null
}

function stableJsonStringify(value: unknown): string {
  if (value === null) {
    return 'null'
  }
  const valueType = typeof value
  if (valueType === 'string') {
    return JSON.stringify(value)
  }
  if (valueType === 'number' || valueType === 'boolean') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(',')}]`
  }
  if (valueType === 'object') {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record).sort()
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJsonStringify(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/** Canonical JSON shape for duplicate detection (sorted keys; embedded payloads ok). */
export function canonicalizeJsonFromNoteText(text: string): string | null {
  const extracted = tryExtractEmbeddedJsonPayload(text.trim())
  if (extracted === null) {
    return null
  }
  try {
    return stableJsonStringify(JSON.parse(extracted) as unknown)
  } catch {
    return null
  }
}
