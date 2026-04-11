import { generateStructuredResponse } from './ollamaService'
import { getSettings } from './settingsService'
import { loadSkill } from './skillLoader'
import { logger } from '../logger'
import { appendUserInstructionsToSystemPrompt } from './userInstructionsContext'
import { extractTodoMeasureMap } from './documentPipeline'
import {
  appendVerbosePipelineStageRecord,
  truncateForSubAgentPipelineTraceDefault,
} from './pipelineTraceVerbose'
import type {
  CommandResolution,
  CommandOperation,
  ConversationEntry,
  LoreDocument,
  MutablePipelineTraceSink,
  PipelineCommandDecompositionTraceOutput,
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

function buildCommandDecompositionTraceOutput(resolution: CommandResolution): PipelineCommandDecompositionTraceOutput {
  if (resolution.status === 'execute') {
    return {
      status: 'execute',
      operationSummaries: resolution.operations.map((operation) => ({
        action: operation.action,
        targetDocumentIdCount: operation.targetDocumentIds.length,
        confidence: operation.confidence,
      })),
      clarificationCandidateDocumentIdCount: null,
      clarifyPresentationStyle: null,
      clarificationMessagePreview: null,
    }
  }

  const clarificationPreview =
    resolution.clarificationMessage.trim().length > 0
      ? resolution.clarificationMessage.trim()
      : resolution.clarifyPresentation?.style === 'model_authored_text'
        ? resolution.clarifyPresentation.text
        : resolution.clarifyPresentation?.style === 'uncertain'
          ? resolution.clarifyPresentation.hint ?? ''
          : ''

  return {
    status: 'clarify',
    operationSummaries: [],
    clarificationCandidateDocumentIdCount:
      resolution.clarificationCandidateDocumentIds !== undefined
        ? resolution.clarificationCandidateDocumentIds.length
        : null,
    clarifyPresentationStyle: resolution.clarifyPresentation?.style ?? null,
    clarificationMessagePreview:
      clarificationPreview.length > 0
        ? truncateForSubAgentPipelineTraceDefault(clarificationPreview)
        : null,
  }
}

function recordCommandDecompositionPipelineStage(
  pipelineTraceSink: MutablePipelineTraceSink | null | undefined,
  resolution: CommandResolution,
): void {
  appendVerbosePipelineStageRecord(pipelineTraceSink, {
    stageId: 'command_decomposition',
    ordinal: 0,
    output: buildCommandDecompositionTraceOutput(resolution),
  })
}

export async function resolveCommandTargets(
  userInput: string,
  documents: readonly LoreDocument[],
  conversationHistory: readonly ConversationEntry[] = [],
  userInstructionsBlock: string = '',
  classifiedCommandIntent: 'edit' | 'delete' | undefined = undefined,
  pipelineTraceSink: MutablePipelineTraceSink | null = null,
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

  const classifiedIntentLine =
    classifiedCommandIntent === 'delete'
      ? '\n\nClassifier intent: DELETE (remove matching rows from storage). Every operation must use action "delete" with updatedContent null. Never use "update" to stand in for removal.'
      : classifiedCommandIntent === 'edit'
        ? '\n\nClassifier intent: EDIT (change stored text). Use action "update" with the new text the user asked for; do not delete unless they clearly asked to remove rows.'
        : ''

  messages.push({
    role: 'user',
    content: [
      '<lore_user_command>',
      `User wants to: ${userInput}${classifiedIntentLine}`,
      '</lore_user_command>',
      '',
      '<lore_matching_documents>',
      'Matching documents from database:',
      docsForPrompt,
      '</lore_matching_documents>',
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

    const finalized = finalizeCommandResolutionWithMandatoryCandidateListing(
      resolution,
      documents,
      classifiedCommandIntent,
    )
    recordCommandDecompositionPipelineStage(pipelineTraceSink, finalized)
    return finalized
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
  classifiedCommandIntent: 'edit' | 'delete' | undefined,
): CommandResolution {
  const validIds = new Set(documents.map((document) => document.id))

  if (parsed.status === 'clarify') {
    const candidateIds = parseModelClarificationCandidateDocumentIds(parsed, validIds)
    const modelText = typeof parsed.clarificationMessage === 'string'
      ? parsed.clarificationMessage
      : "I'm not sure which documents you're referring to. Could you be more specific?"
    return {
      status: 'clarify',
      operations: [],
      clarificationMessage: modelText,
      clarificationCandidateDocumentIds:
        candidateIds ?? documents.map((document) => document.id),
      clarifyPresentation: { style: 'model_authored_text', text: modelText },
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
        clarificationMessage: '',
        clarificationCandidateDocumentIds: documents.map((document) => document.id),
        clarifyPresentation: { style: 'uncertain', hint: description.trim().length > 0 ? description : null },
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
      clarificationMessage: '',
      clarificationCandidateDocumentIds: documents.map((document) => document.id),
      clarifyPresentation: { style: 'no_resolvable_targets' },
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

/** Numbered options and blockquoted bodies only (for assistant-user-reply `command_target_clarify`). */
export function buildVerbatimNumberedOptionsBlock(
  action: CommandOperation['action'],
  orderedDocuments: readonly LoreDocument[],
): string {
  const blocks = orderedDocuments.map((document, index) => {
    const quotedBody = formatDocumentContentAsBlockquoteLines(document.content)
    return `Option ${index + 1}:\n${quotedBody}`
  })
  return blocks.join('\n\n')
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
  const verbatimNumberedOptionsBlock = buildVerbatimNumberedOptionsBlock(commandAction, orderedDocuments)
  return {
    ...resolution,
    clarificationMessage: '',
    clarifyPresentation: {
      style: 'template_numbered_options',
      commandIntent: commandAction === 'update' ? 'edit' : 'delete',
      verbatimNumberedOptionsBlock,
    },
    clarificationCandidateDocumentIds: orderedDocuments.map((document) => document.id),
  }
}

function buildLiteralMismatchClarification(
  action: CommandOperation['action'],
  documents: readonly LoreDocument[],
): CommandResolution {
  const verbatimNumberedOptionsBlock = buildVerbatimNumberedOptionsBlock(action, documents)
  return {
    status: 'clarify',
    operations: [],
    clarificationMessage: '',
    clarifyPresentation: {
      style: 'template_numbered_options',
      commandIntent: action === 'update' ? 'edit' : 'delete',
      verbatimNumberedOptionsBlock,
    },
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

function normalizeContentForMatching(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}
