import { logger } from '../logger'
import { handleThought } from './handlers/thoughtHandler'
import { handleQuestion } from './handlers/questionHandler'
import { handleCommand } from './handlers/commandHandler'
import { handleConversational } from './handlers/conversationalHandler'
import type {
  ActionOutcome,
  AgentEvent,
  ClassificationAction,
  ConversationEntry,
  InputClassification,
  LoreDocument,
} from '../../shared/types'

function inferStatusFromMessage(message: string): 'succeeded' | 'failed' {
  const lower = message.toLowerCase()
  if (
    lower.includes('could not')
    || lower.includes('no matching')
    || lower.includes('nothing to save')
    || lower.includes('no documents')
  ) {
    return 'failed'
  }
  return 'succeeded'
}

function synthesizeHandlerResultSummary(params: {
  readonly action: ClassificationAction
  readonly hadError: boolean
  readonly errorMessage: string
  readonly hadStored: boolean
  readonly hadDeleted: boolean
  readonly sawDuplicateEvent: boolean
  readonly storedDocumentIds: readonly string[]
  readonly retrievedDocumentIds: readonly string[]
  readonly deletedDocumentCount: number
  readonly chunkContent: string
}): string {
  if (params.hadError) {
    return `This step failed: ${params.errorMessage}`
  }

  if (params.action.intent === 'save') {
    if (params.sawDuplicateEvent && !params.hadStored) {
      return 'Save: very similar content already exists; user was prompted to choose add new or update. No new row was stored in this step.'
    }
    if (params.hadStored) {
      return `Save: stored ${params.storedDocumentIds.length} document(s).`
    }
    return 'Save: completed without recording a new stored id in this step.'
  }

  if (params.action.intent === 'read') {
    if (params.retrievedDocumentIds.length === 0) {
      return 'Read: no documents were retrieved; reply used the empty-library / no-context path.'
    }
    return `Read: used ${params.retrievedDocumentIds.length} retrieved document id(s) to produce the answer.`
  }

  if (params.action.intent === 'edit' || params.action.intent === 'delete') {
    if (params.deletedDocumentCount > 0) {
      return `Command: removed ${params.deletedDocumentCount} document(s).`
    }
    if (params.hadStored) {
      return 'Command: updated stored content (same document id reused).'
    }
    return 'Command: finished; see user-facing message for whether anything matched.'
  }

  if (params.action.intent === 'speak') {
    return 'Speak: conversational reply text was produced for this step.'
  }

  const trimmed = params.chunkContent.trim()
  if (trimmed.length > 0) {
    return `Step detail (from streamed text): ${trimmed.slice(0, 400)}${trimmed.length > 400 ? '…' : ''}`
  }

  return 'Step completed with no streamed user text and no extra telemetry.'
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected error occurred'
}

export function buildClassificationActionInput(
  action: ClassificationAction,
  fallbackUserInput: string,
): string {
  if (action.data.trim().length > 0) {
    return action.data
  }
  return fallbackUserInput
}

export function classificationIntentStatusLabel(intent: InputClassification): string {
  switch (intent) {
    case 'save':
      return 'Saving…'
    case 'read':
      return 'Retrieving and answering…'
    case 'edit':
    case 'delete':
      return 'Applying changes…'
    case 'speak':
      return 'Replying…'
  }
}

type HandlerInvocation = (
  actionInput: string,
  action: ClassificationAction,
  history: ConversationEntry[],
  userInstructionDocuments: readonly LoreDocument[],
  userInstructionsBlock: string,
) => AsyncGenerator<AgentEvent>

function selectHandler(action: ClassificationAction): HandlerInvocation {
  switch (action.intent) {
    case 'save':
      return async function* (input, classification, history, _, instructions) {
        yield* handleThought(input, classification, history, instructions)
      }
    case 'read':
      return async function* (input, classification, history, instructionDocs, instructions) {
        const isTodoQuery = classification.extractedTags.some((tag) => tag === 'todo')
        const todoOverrides = isTodoQuery ? ({ type: 'todo' } as const) : undefined
        yield* handleQuestion(input, classification, history, todoOverrides, instructionDocs, instructions)
      }
    case 'edit':
    case 'delete':
      return async function* (input, classification, history, _, instructions) {
        yield* handleCommand(input, classification, history, undefined, instructions)
      }
    case 'speak':
      return async function* (input, classification, history, _, instructions) {
        yield* handleConversational(input, classification, history, instructions)
      }
  }
}

export interface ExecuteClassificationActionParams {
  readonly action: ClassificationAction
  readonly actionInput: string
  readonly actionIndex: number
  readonly conversationHistory: readonly ConversationEntry[]
  readonly userInstructionDocuments: readonly LoreDocument[]
  readonly userInstructionsBlock: string
}

/**
 * Runs one classified action: yields side-effect events for the UI (status, stored, chunks for speak, …).
 * Returns an {@link ActionOutcome} (including document touch metadata) for the turn-level reply composer.
 */
export async function* executeClassificationAction(
  params: ExecuteClassificationActionParams,
): AsyncGenerator<AgentEvent, ActionOutcome> {
  const {
    action,
    actionInput,
    actionIndex,
    conversationHistory,
    userInstructionDocuments,
    userInstructionsBlock,
  } = params

  let chunkContent = ''
  let hadError = false
  let errorMessage = ''
  let hadStored = false
  let hadDeleted = false
  const storedDocumentIds: string[] = []
  const retrievedDocumentIds: string[] = []
  let deletedDocumentCount = 0
  let sawDuplicateEvent = false
  let explicitHandlerSummary = ''

  try {
    const handler = selectHandler(action)
    for await (const event of handler(
      actionInput,
      action,
      [...conversationHistory],
      userInstructionDocuments,
      userInstructionsBlock,
    )) {
      if (event.type === 'turn_step_summary') {
        explicitHandlerSummary = event.summary
        continue
      }

      if (event.type === 'chunk') {
        chunkContent += event.content
        if (action.intent === 'speak') {
          yield event
        }
      } else if (event.type !== 'done') {
        yield event
      }

      if (event.type === 'stored') {
        hadStored = true
        storedDocumentIds.push(event.documentId)
      }
      if (event.type === 'deleted') {
        hadDeleted = true
        deletedDocumentCount += 1
      }
      if (event.type === 'retrieved') {
        retrievedDocumentIds.push(...event.documentIds)
      }
      if (event.type === 'duplicate') {
        sawDuplicateEvent = true
      }
      if (event.type === 'error') {
        hadError = true
        errorMessage = event.message
      }
    }
  } catch (err) {
    hadError = true
    errorMessage = toErrorMessage(err)
    logger.error({ err, actionIndex }, '[ClassificationActionExecutor] Handler failed')
  }

  const status = hadError
    ? 'failed'
    : (action.intent === 'save' && hadStored) || (action.intent === 'delete' && hadDeleted)
      ? 'succeeded'
      : inferStatusFromMessage(chunkContent)

  const message = hadError ? errorMessage : (chunkContent.trim() || 'Done.')

  const handlerResultSummary =
    explicitHandlerSummary.trim().length > 0
      ? explicitHandlerSummary.trim()
      : synthesizeHandlerResultSummary({
          action,
          hadError,
          errorMessage,
          hadStored,
          hadDeleted,
          sawDuplicateEvent,
          storedDocumentIds,
          retrievedDocumentIds,
          deletedDocumentCount,
          chunkContent,
        })

  return {
    intent: action.intent,
    saveDocumentType: action.intent === 'save' ? action.saveDocumentType : null,
    situationSummary: action.situationSummary,
    status,
    message,
    handlerResultSummary,
    storedDocumentIds,
    retrievedDocumentIds,
    deletedDocumentCount,
  }
}
