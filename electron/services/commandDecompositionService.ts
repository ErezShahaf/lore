import { generateStructuredResponse } from './ollamaService'
import { getSettings } from './settingsService'
import { loadSkill } from './skillLoader'
import { logger } from '../logger'
import { appendUserInstructionsToSystemPrompt } from './userInstructionsContext'
import type {
  CommandResolution,
  CommandOperation,
  ConversationEntry,
  LoreDocument,
} from '../../shared/types'

const COMMAND_RESOLUTION_SCHEMA = {
  type: 'object',
  properties: {
    status: {
      type: 'string',
      enum: ['execute', 'clarify'],
    },
    operations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          targetDocumentIds: {
            type: 'array',
            items: { type: 'string' },
          },
          action: {
            type: 'string',
            enum: ['delete', 'update'],
          },
          updatedContent: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
          },
          confidence: { type: 'number' },
          description: { type: 'string' },
        },
        required: ['targetDocumentIds', 'action', 'updatedContent', 'confidence', 'description'],
        additionalProperties: false,
      },
    },
    clarificationMessage: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
    },
  },
  required: ['status', 'operations', 'clarificationMessage'],
  additionalProperties: false,
}

const MAX_RETRIES = 2
const MIN_OPERATION_CONFIDENCE = 0.5
const MIN_CLEAR_MATCH_SCORE = 0.6
const MIN_CLEAR_MATCH_GAP = 0.2
const QUOTED_REPLACEMENT_PATTERNS = [
  /\bchange\s+"([^"]+)"\s+to\s+"([^"]+)"\s*$/i,
  /\bedit\s+"([^"]+)"\s+to\s+"([^"]+)"\s*$/i,
  /\breplace\s+"([^"]+)"\s+with\s+"([^"]+)"\s*$/i,
] as const
const REFERENTIAL_UPDATE_PATTERNS = [
  /\bchange\s+(?:it|that|this|the one[^.]*)\s+to\s+(.+)$/i,
  /\bedit\s+(?:it|that|this|the one[^.]*)\s+to\s+(.+)$/i,
  /\breplace\s+(?:it|that|this|the one[^.]*)\s+with\s+(.+)$/i,
] as const

interface ParsedDeterministicCommand {
  readonly action: CommandOperation['action']
  readonly referenceText: string
  readonly updatedContent: string | null
  readonly exactReferenceContent: string | null
}

export async function resolveCommandTargets(
  userInput: string,
  documents: readonly LoreDocument[],
  conversationHistory: readonly ConversationEntry[] = [],
  userInstructionsBlock: string = '',
): Promise<CommandResolution> {
  const settings = getSettings()

  const docsForPrompt = documents
    .map((document) => `ID: ${document.id}\nType: ${document.type}\nDate: ${document.date}\nContent: ${document.content}`)
    .join('\n---\n')

  const systemPrompt = appendUserInstructionsToSystemPrompt(loadSkill('command-decomposition'), userInstructionsBlock)

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
  ]

  for (const entry of conversationHistory) {
    messages.push({ role: entry.role, content: entry.content })
  }

  messages.push({
    role: 'user',
    content: `User wants to: ${userInput}\n\nMatching documents from database:\n${docsForPrompt}`,
  })

  try {
    const resolution = await generateStructuredResponse({
      model: settings.selectedModel,
      messages,
      schema: COMMAND_RESOLUTION_SCHEMA,
      maxAttempts: MAX_RETRIES,
      validate: (parsed) => validateResolution(userInput, parsed, documents),
    })

    logger.debug(
      {
        status: resolution.status,
        operationCount: resolution.status === 'execute' ? resolution.operations.length : 0,
      },
      '[CommandDecomposition] Resolved command',
    )

    return resolution
  } catch (error) {
    logger.error(
      { error },
      '[CommandDecomposition] All attempts failed',
    )
    throw new Error(
      `Command decomposition failed after ${MAX_RETRIES} attempts: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function validateResolution(
  userInput: string,
  parsed: Record<string, unknown>,
  documents: readonly LoreDocument[],
): CommandResolution {
  if (parsed.status === 'clarify') {
    return {
      status: 'clarify',
      operations: [],
      clarificationMessage: typeof parsed.clarificationMessage === 'string'
        ? parsed.clarificationMessage
        : "I'm not sure which documents you're referring to. Could you be more specific?",
    }
  }

  const validIds = new Set(documents.map((document) => document.id))
  const rawOperations = Array.isArray(parsed.operations) ? parsed.operations : []
  const operations: CommandOperation[] = []

  for (const rawOperation of rawOperations) {
    if (!rawOperation || typeof rawOperation !== 'object') continue

    const targetIds = Array.isArray(rawOperation.targetDocumentIds)
      ? rawOperation.targetDocumentIds.filter(
          (id: unknown): id is string => typeof id === 'string' && validIds.has(id as string),
        )
      : []

    if (targetIds.length === 0) continue

    const action = validateAction(rawOperation.action)
    const confidence = typeof rawOperation.confidence === 'number' ? rawOperation.confidence : 0.5

    if (confidence < MIN_OPERATION_CONFIDENCE) {
      const description = typeof rawOperation.description === 'string' ? rawOperation.description : ''
      return {
        status: 'clarify',
        operations: [],
        clarificationMessage: description
          ? `I'm not confident about this: "${description}". Could you be more specific about which document you mean?`
          : "I'm not sure which documents you're referring to. Could you be more specific?",
      }
    }

    operations.push({
      targetDocumentIds: targetIds,
      action,
      updatedContent: typeof rawOperation.updatedContent === 'string' ? rawOperation.updatedContent : null,
      confidence,
      description: typeof rawOperation.description === 'string' ? rawOperation.description : '',
    })
  }

  if (operations.length === 0) {
    return {
      status: 'clarify',
      operations: [],
      clarificationMessage: "I couldn't determine which documents you're referring to. Could you be more specific?",
    }
  }

  return {
    status: 'execute',
    operations,
    clarificationMessage: null,
  }
}

function validateAction(value: unknown): CommandOperation['action'] {
  const validActions: CommandOperation['action'][] = ['delete', 'update']
  return validActions.includes(value as CommandOperation['action'])
    ? (value as CommandOperation['action'])
    : 'delete'
}

interface CandidateMatch {
  readonly document: LoreDocument
  readonly score: number
}

// Not used anymore after moving to LLM-only resolution.
// Keeping the implementation for potential future regression debugging.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function tryResolveCommandDeterministically(
  userInput: string,
  documents: readonly LoreDocument[],
): CommandResolution | null {
  const parsedCommand = parseDeterministicCommand(userInput)
  if (!parsedCommand) {
    return null
  }

  const exactReferenceMatch = parsedCommand.exactReferenceContent
    ? findUniqueExactContentMatch(parsedCommand.exactReferenceContent, documents)
    : null
  if (exactReferenceMatch) {
    return buildSingleTargetExecutionResolution(
      parsedCommand.action,
      exactReferenceMatch,
      parsedCommand.updatedContent,
      userInput,
    )
  }

  const candidateMatches = rankCandidateMatches(parsedCommand.referenceText, documents)
  const clearCandidate = selectClearSingleCandidate(candidateMatches)
  if (!clearCandidate) {
    return null
  }

  return buildSingleTargetExecutionResolution(
    parsedCommand.action,
    clearCandidate.document,
    parsedCommand.updatedContent,
    userInput,
  )
}

function parseDeterministicCommand(userInput: string): ParsedDeterministicCommand | null {
  for (const pattern of QUOTED_REPLACEMENT_PATTERNS) {
    const match = pattern.exec(userInput)
    if (!match) {
      continue
    }

    return {
      action: 'update',
      referenceText: match[1],
      updatedContent: match[2].trim(),
      exactReferenceContent: match[1],
    }
  }

  for (const pattern of REFERENTIAL_UPDATE_PATTERNS) {
    const match = pattern.exec(userInput.trim())
    if (!match) {
      continue
    }

    const updatedContent = trimTrailingPunctuation(match[1])
    const referenceText = userInput.slice(0, match.index).trim()

    if (referenceText.length === 0 || updatedContent.length === 0) {
      continue
    }

    return {
      action: 'update',
      referenceText,
      updatedContent,
      exactReferenceContent: null,
    }
  }

  if (/\b(delete|remove|forget|clear|done|finished|completed|complete)\b/i.test(userInput)) {
    return {
      action: 'delete',
      referenceText: userInput,
      updatedContent: null,
      exactReferenceContent: extractQuotedReference(userInput),
    }
  }

  if (/\b(update|change|replace|edit|rename)\b/i.test(userInput)) {
    return {
      action: 'update',
      referenceText: userInput,
      updatedContent: null,
      exactReferenceContent: extractQuotedReference(userInput),
    }
  }

  return null
}

function extractQuotedReference(userInput: string): string | null {
  const quotedMatch = userInput.match(/"([^"]+)"/)
  return quotedMatch ? quotedMatch[1] : null
}

function trimTrailingPunctuation(value: string): string {
  return value.trim().replace(/[.?!]+$/, '').trim()
}

function normalizeContentForMatching(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

function findUniqueExactContentMatch(
  referenceContent: string,
  documents: readonly LoreDocument[],
): LoreDocument | null {
  const normalizedReferenceContent = normalizeContentForMatching(referenceContent)
  const matches = documents.filter((document) =>
    normalizeContentForMatching(document.content) === normalizedReferenceContent,
  )

  return matches.length === 1 ? matches[0] : null
}

function selectClearSingleCandidate(candidateMatches: readonly CandidateMatch[]): CandidateMatch | null {
  const chosenCandidate = candidateMatches[0]
  const runnerUp = candidateMatches[1]
  const plausibleCandidates = candidateMatches.filter((candidate) => candidate.score >= MIN_CLEAR_MATCH_SCORE)

  const chosenIsClearlyBest = chosenCandidate !== undefined
    && chosenCandidate.score >= MIN_CLEAR_MATCH_SCORE
    && (!runnerUp || chosenCandidate.score - runnerUp.score >= MIN_CLEAR_MATCH_GAP)
    && plausibleCandidates.length <= 1

  return chosenIsClearlyBest ? chosenCandidate : null
}

function buildSingleTargetExecutionResolution(
  action: CommandOperation['action'],
  document: LoreDocument,
  updatedContent: string | null,
  userInput: string,
): CommandResolution {
  const description = action === 'delete'
    ? `Delete "${truncateContent(document.content, 60)}"`
    : `Update "${truncateContent(document.content, 60)}"`

  return {
    status: 'execute',
    operations: [{
      targetDocumentIds: [document.id],
      action,
      updatedContent,
      confidence: 0.99,
      description: userInput.length > 0 ? description : '',
    }],
    clarificationMessage: null,
  }
}

function extractReferenceTextForSafety(
  userInput: string,
  operation: CommandOperation,
): string {
  const parsedCommand = parseDeterministicCommand(userInput)
  if (parsedCommand && parsedCommand.referenceText.length > 0) {
    return parsedCommand.referenceText
  }

  return userInput.length > 0 ? userInput : operation.description
}

function rankCandidateMatches(referenceText: string, documents: readonly LoreDocument[]): CandidateMatch[] {
  const salientTerms = extractSalientTerms(referenceText)
  if (salientTerms.length === 0) {
    return documents.map((document) => ({ document, score: 0 }))
  }

  return documents.map((document) => ({
    document,
    score: scoreDocumentMatch(salientTerms, document.content),
  })).filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score)
}

function scoreDocumentMatch(salientTerms: readonly string[], content: string): number {
  const documentTerms = extractSalientTerms(content)
  if (documentTerms.length === 0) {
    return 0
  }

  const matchedTerms = salientTerms.filter((salientTerm) => {
    return documentTerms.some((documentTerm) =>
      documentTerm === salientTerm
      || documentTerm.startsWith(salientTerm)
      || salientTerm.startsWith(documentTerm))
  }).length

  return matchedTerms / salientTerms.length
}

const MAX_CLARIFICATION_LIST_ITEMS = 8

function buildCandidateClarification(
  candidateMatches: readonly CandidateMatch[],
  documents: readonly LoreDocument[],
  prefix: string,
): string {
  const rawCandidates = candidateMatches.length > 0
    ? candidateMatches
    : documents.map((document) => ({ document, score: 0 }))
  const previewCandidates = [...rawCandidates].sort((a, b) =>
    a.document.content.localeCompare(b.document.content) || a.document.id.localeCompare(b.document.id),
  )

  const previewList = previewCandidates
    .slice(0, MAX_CLARIFICATION_LIST_ITEMS)
    .map((candidate, index) => `${index + 1}. "${truncateContent(candidate.document.content, 60)}"`)
    .join('\n')

  if (previewList.length === 0) {
    return `${prefix} Could you be more specific?`
  }

  const listedCount = Math.min(previewCandidates.length, MAX_CLARIFICATION_LIST_ITEMS)
  const replyHint = listedCount >= 2
    ? '\n\nYou can reply with the number as it appears (1, 2, …), say **all** or **all of them** for every item, or describe which one.'
    : '\n\nYou can reply with the number (1) or describe which one.'

  return `${prefix}\n${previewList}\n\nWhich one did you mean?${replyHint}`
}

function extractSalientTerms(text: string): string[] {
  const ignoredTerms = new Set([
    'about',
    'already',
    'completed',
    'complete',
    'delete',
    'done',
    'finished',
    'forgot',
    'forget',
    'from',
    'have',
    'item',
    'just',
    'like',
    'mark',
    'need',
    'note',
    'remove',
    'task',
    'that',
    'the',
    'them',
    'this',
    'todo',
    'update',
    'want',
    'with',
    'wrote',
  ])

  const normalizedTerms = text
    .toLowerCase()
    .match(/[a-z0-9]+/g)
    ?.map((term) => normalizeTerm(term))
    .filter((term) => term.length >= 4 && !ignoredTerms.has(term))

  return normalizedTerms ? [...new Set(normalizedTerms)] : []
}

function normalizeTerm(term: string): string {
  if (term.endsWith('ing') && term.length > 5) {
    return term.slice(0, -3)
  }

  if (term.endsWith('ed') && term.length > 4) {
    return term.slice(0, -2)
  }

  if (term.endsWith('es') && term.length > 4) {
    return term.slice(0, -2)
  }

  if (term.endsWith('s') && term.length > 4) {
    return term.slice(0, -1)
  }

  return term
}

function truncateContent(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text
  }

  return text.slice(0, maxLength) + '...'
}
