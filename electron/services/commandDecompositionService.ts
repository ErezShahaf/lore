import { generateStructuredResponse } from './ollamaService'
import { getSettings } from './settingsService'
import { loadSkill } from './skillLoader'
import { logger } from '../logger'
import { appendUserInstructionsToSystemPrompt } from './userInstructionsContext'
import { extractTodoMeasureMap } from './documentPipeline'
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
    clarificationCandidateDocumentIds: {
      anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }],
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
  classifiedCommandIntent: 'edit' | 'delete' | undefined = undefined,
): Promise<CommandResolution> {
  const settings = getSettings()

  const deterministicResolution = tryResolveCommandDeterministically(userInput, documents)
  if (deterministicResolution !== null) {
    logger.debug(
      { userInput, status: deterministicResolution.status },
      '[CommandDecomposition] Deterministic resolution',
    )
    const appliedDeterministic = applyClassifiedIntentToResolution(
      deterministicResolution,
      classifiedCommandIntent,
    )
    if (
      appliedDeterministic.status === 'execute'
      && classifiedCommandIntent === 'delete'
    ) {
      const literalClarify = clarifyIfDeleteLiteralsMismatchTargets(
        userInput,
        appliedDeterministic.operations,
        documents,
      )
      if (literalClarify !== null) {
        return literalClarify
      }
    }
    return finalizeCommandResolutionWithMandatoryCandidateListing(
      appliedDeterministic,
      documents,
      classifiedCommandIntent,
    )
  }

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

  const classifiedIntentLine =
    classifiedCommandIntent === 'delete'
      ? '\n\nClassifier intent: DELETE (remove matching rows from storage). Every operation must use action "delete" with updatedContent null. Never use "update" to stand in for removal.'
      : classifiedCommandIntent === 'edit'
        ? '\n\nClassifier intent: EDIT (change stored text). Use action "update" with the new text the user asked for; do not delete unless they clearly asked to remove rows.'
        : ''

  messages.push({
    role: 'user',
    content: [
      `User wants to: ${userInput}${classifiedIntentLine}`,
      '',
      'Matching documents from database:',
      docsForPrompt,
      '',
      'When status is "clarify" because several rows could match, set clarificationCandidateDocumentIds to the document id of each row you are asking the user to choose among (only ids from the list above, at least two ids, no extras). If you omit it or it is invalid, every row may be treated as in play.',
    ].join('\n'),
  })

  try {
    const resolution = await generateStructuredResponse({
      model: settings.selectedModel,
      messages,
      schema: COMMAND_RESOLUTION_SCHEMA,
      maxAttempts: MAX_RETRIES,
      validate: (parsed) => validateResolution(userInput, parsed, documents, classifiedCommandIntent),
    })

    logger.debug(
      {
        status: resolution.status,
        operationCount: resolution.status === 'execute' ? resolution.operations.length : 0,
      },
      '[CommandDecomposition] Resolved command',
    )

    return finalizeCommandResolutionWithMandatoryCandidateListing(
      resolution,
      documents,
      classifiedCommandIntent,
    )
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

function applyClassifiedIntentToResolution(
  resolution: CommandResolution,
  classifiedCommandIntent: 'edit' | 'delete' | undefined,
): CommandResolution {
  if (classifiedCommandIntent !== 'delete' || resolution.status !== 'execute') {
    return resolution
  }

  return {
    ...resolution,
    operations: resolution.operations.map((operation) => ({
      ...operation,
      action: 'delete' as const,
      updatedContent: null,
    })),
  }
}

function validateResolution(
  userInput: string,
  parsed: Record<string, unknown>,
  documents: readonly LoreDocument[],
  classifiedCommandIntent: 'edit' | 'delete' | undefined,
): CommandResolution {
  const validIds = new Set(documents.map((document) => document.id))

  if (parsed.status === 'clarify') {
    const candidateIds = parseModelClarificationCandidateDocumentIds(parsed, validIds)
    return {
      status: 'clarify',
      operations: [],
      clarificationMessage: typeof parsed.clarificationMessage === 'string'
        ? parsed.clarificationMessage
        : "I'm not sure which documents you're referring to. Could you be more specific?",
      clarificationCandidateDocumentIds:
        candidateIds ?? documents.map((document) => document.id),
    }
  }
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
        clarificationCandidateDocumentIds: documents.map((document) => document.id),
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

  const normalizedOperations =
    classifiedCommandIntent === 'delete'
      ? operations.map((operation) => ({
        ...operation,
        action: 'delete' as const,
        updatedContent: null,
      }))
      : operations

  if (normalizedOperations.length === 0) {
    return {
      status: 'clarify',
      operations: [],
      clarificationMessage: "I couldn't determine which documents you're referring to. Could you be more specific?",
      clarificationCandidateDocumentIds: documents.map((document) => document.id),
    }
  }

  if (classifiedCommandIntent === 'delete') {
    const literalClarify = clarifyIfDeleteLiteralsMismatchTargets(
      userInput,
      normalizedOperations,
      documents,
    )
    if (literalClarify !== null) {
      return literalClarify
    }
  }

  return {
    status: 'execute',
    operations: normalizedOperations,
    clarificationMessage: null,
  }
}

function parseModelClarificationCandidateDocumentIds(
  parsed: Record<string, unknown>,
  validIds: ReadonlySet<string>,
): readonly string[] | null {
  const raw = parsed.clarificationCandidateDocumentIds
  if (!Array.isArray(raw)) {
    return null
  }
  const ordered: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (typeof item !== 'string' || !validIds.has(item) || seen.has(item)) {
      continue
    }
    seen.add(item)
    ordered.push(item)
  }
  return ordered.length >= 2 ? ordered : null
}

function documentsMatchingUserTodoMeasures(
  userInput: string,
  documents: readonly LoreDocument[],
): readonly LoreDocument[] | null {
  const userMeasures = extractTodoMeasureMap(userInput)
  if (userMeasures.size === 0) {
    return null
  }
  const matched = documents.filter((document) => {
    const documentMeasures = extractTodoMeasureMap(document.content)
    for (const [unitKey, userValue] of userMeasures) {
      if (!documentMeasures.has(unitKey)) {
        return false
      }
      const documentValue = documentMeasures.get(unitKey)!
      if (Math.abs(userValue - documentValue) > 1e-6) {
        return false
      }
    }
    return true
  })
  return matched.length >= 1 ? matched : null
}

function documentsForLiteralMismatchClarificationList(
  userInput: string,
  documents: readonly LoreDocument[],
): readonly LoreDocument[] {
  const measureMatched = documentsMatchingUserTodoMeasures(userInput, documents)
  if (measureMatched !== null) {
    return measureMatched
  }
  return documents
}

function validateAction(value: unknown): CommandOperation['action'] {
  const validActions: CommandOperation['action'][] = ['delete', 'update']
  return validActions.includes(value as CommandOperation['action'])
    ? (value as CommandOperation['action'])
    : 'delete'
}

/**
 * When the user replies to a numbered clarification with exact text (or measure-bearing text),
 * returns the single matching document among pending candidates, or null if ambiguous or none.
 */
export function findUniquePendingCommandTargetFromText(
  userInput: string,
  candidates: readonly LoreDocument[],
): LoreDocument | null {
  const trimmed = userInput.trim()
  if (trimmed.length < 2 || candidates.length === 0) {
    return null
  }

  const userMeasures = extractTodoMeasureMap(trimmed)
  if (userMeasures.size > 0) {
    const matches = candidates.filter((document) => {
      const documentMeasures = extractTodoMeasureMap(document.content)
      for (const [unitKey, userValue] of userMeasures) {
        if (!documentMeasures.has(unitKey)) {
          return false
        }
        if (Math.abs(documentMeasures.get(unitKey)! - userValue) > 1e-6) {
          return false
        }
      }
      return true
    })
    return matches.length === 1 ? matches[0]! : null
  }

  const quotedOnly = trimmed.match(/^"([^"]+)"$/)
  const normalizedUser = normalizeContentForMatching(
    quotedOnly ? quotedOnly[1]!.trim() : trimmed,
  )
  if (normalizedUser.length < 2) {
    return null
  }

  const matches = candidates.filter(
    (document) => normalizeContentForMatching(document.content) === normalizedUser,
  )
  return matches.length === 1 ? matches[0]! : null
}

interface CandidateMatch {
  readonly document: LoreDocument
  readonly score: number
}

const AMBIGUOUS_CANDIDATE_CONTENT_MAX_CHARS = 2000

function formatDocumentContentAsBlockquoteLines(rawContent: string): string {
  const trimmed = rawContent.trim()
  const truncated =
    trimmed.length > AMBIGUOUS_CANDIDATE_CONTENT_MAX_CHARS
      ? `${trimmed.slice(0, AMBIGUOUS_CANDIDATE_CONTENT_MAX_CHARS)}...`
      : trimmed
  if (truncated.length === 0) {
    return '>'
  }
  return truncated
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
}

export function buildClarificationCandidateListMessage(
  action: CommandOperation['action'],
  orderedDocuments: readonly LoreDocument[],
): string {
  const verb = action === 'delete' ? 'remove' : 'change'
  const blocks = orderedDocuments.map((document, index) => {
    const quotedBody = formatDocumentContentAsBlockquoteLines(document.content)
    return `Option ${index + 1}:\n${quotedBody}`
  })
  return [
    `More than one saved item matches; I am not sure which one you want to ${verb}:`,
    '',
    blocks.join('\n\n'),
    '',
    'Reply with the number or paste the exact wording of the item you mean.',
  ].join('\n')
}

function finalizeCommandResolutionWithMandatoryCandidateListing(
  resolution: CommandResolution,
  documents: readonly LoreDocument[],
  classifiedCommandIntent: 'edit' | 'delete' | undefined,
): CommandResolution {
  if (resolution.status !== 'clarify') {
    return resolution
  }
  if (resolution.preserveClarificationWording === true) {
    return resolution
  }

  const documentById = new Map(documents.map((document) => [document.id, document]))
  const subsetIds = resolution.clarificationCandidateDocumentIds
  const orderedFromSubset =
    subsetIds !== undefined && subsetIds.length >= 2
      ? subsetIds
          .map((id) => documentById.get(id))
          .filter((document): document is LoreDocument => document !== undefined)
      : []

  const orderedDocuments =
    orderedFromSubset.length >= 2
      ? orderedFromSubset
      : documents.length >= 2
        ? [...documents]
        : []

  if (orderedDocuments.length < 2) {
    return resolution
  }

  const commandAction: CommandOperation['action'] =
    classifiedCommandIntent === 'edit' ? 'update' : 'delete'
  return {
    ...resolution,
    clarificationMessage: buildClarificationCandidateListMessage(commandAction, orderedDocuments),
    clarificationCandidateDocumentIds: orderedDocuments.map((document) => document.id),
  }
}

function buildLiteralMismatchClarification(
  action: CommandOperation['action'],
  documents: readonly LoreDocument[],
): CommandResolution {
  const verb = action === 'delete' ? 'remove' : 'change'
  const blocks = documents.map((document, index) => {
    const quotedBody = formatDocumentContentAsBlockquoteLines(document.content)
    return `Option ${index + 1}:\n${quotedBody}`
  })
  return {
    status: 'clarify',
    operations: [],
    clarificationMessage: [
      `I could not match your wording to a single row to ${verb}. Here are the items from this search:`,
      '',
      blocks.join('\n\n'),
      '',
      'Reply with the number or paste the exact wording of the item you mean.',
    ].join('\n'),
    clarificationCandidateDocumentIds: documents.map((document) => document.id),
    preserveClarificationWording: true,
  }
}

function clarifyIfDeleteLiteralsMismatchTargets(
  userInput: string,
  operations: readonly CommandOperation[],
  documents: readonly LoreDocument[],
): CommandResolution | null {
  const documentById = new Map(documents.map((document) => [document.id, document]))
  const userMeasures = extractTodoMeasureMap(userInput)
  const quotedPhrases = [...userInput.matchAll(/"([^"]+)"/g)]
    .map((match) => normalizeContentForMatching(match[1]))
    .filter((phrase) => phrase.length >= 2)
  const listDocuments = documentsForLiteralMismatchClarificationList(userInput, documents)

  for (const operation of operations) {
    if (operation.action !== 'delete') continue
    for (const targetId of operation.targetDocumentIds) {
      const targetDocument = documentById.get(targetId)
      if (!targetDocument) continue

      if (userMeasures.size > 0) {
        const documentMeasures = extractTodoMeasureMap(targetDocument.content)
        for (const [unitKey, userValue] of userMeasures) {
          if (!documentMeasures.has(unitKey)) {
            return buildLiteralMismatchClarification('delete', listDocuments)
          }
          const documentValue = documentMeasures.get(unitKey)!
          if (Math.abs(userValue - documentValue) > 1e-6) {
            return buildLiteralMismatchClarification('delete', listDocuments)
          }
        }
      }

      const normalizedContent = normalizeContentForMatching(targetDocument.content)
      for (const phrase of quotedPhrases) {
        if (!normalizedContent.includes(phrase)) {
          return buildLiteralMismatchClarification('delete', listDocuments)
        }
      }
    }
  }
  return null
}

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
  if (clearCandidate) {
    return buildSingleTargetExecutionResolution(
      parsedCommand.action,
      clearCandidate.document,
      parsedCommand.updatedContent,
      userInput,
    )
  }

  const strongMatches = candidateMatches.filter((candidate) => candidate.score >= MIN_CLEAR_MATCH_SCORE)
  if (strongMatches.length >= 2) {
    const orderedDocuments = strongMatches.map((match) => match.document)
    return {
      status: 'clarify',
      operations: [],
      clarificationMessage: buildClarificationCandidateListMessage(parsedCommand.action, orderedDocuments),
      clarificationCandidateDocumentIds: orderedDocuments.map((document) => document.id),
    }
  }

  return null
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

  if (/\b(delete|remove|forget|clear|finished|completed|complete)\b/i.test(userInput)) {
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
