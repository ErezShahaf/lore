import { logger } from '../logger'
import { classifyInputUnified } from './unifiedClassifierService'
import { formatUserInstructionsBlock, loadAllUserInstructionDocuments } from './userInstructionsContext'
import { retrieveRelevantDocuments } from './documentPipeline'
import { handleThought } from './handlers/thoughtHandler'
import { handleQuestion } from './handlers/questionHandler'
import { handleCommand } from './handlers/commandHandler'
import { handleConversational } from './handlers/conversationalHandler'
import { streamAssistantUserReplyWithFallback } from './assistantReplyComposer'
import type {
  AgentEvent,
  ActionOutcome,
  ClassificationAction,
  ConversationEntry,
  InputClassification,
} from '../../shared/types'

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected error occurred'
}

function actionToStatusLabel(intent: InputClassification): string {
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

function inferStatusFromMessage(message: string, intent: InputClassification): 'succeeded' | 'failed' {
  const lower = message.toLowerCase()
  if (
    lower.includes('could not') ||
    lower.includes('no matching') ||
    lower.includes('nothing to save') ||
    lower.includes('no documents')
  ) {
    return 'failed'
  }
  return 'succeeded'
}

function buildActionInput(action: ClassificationAction, fallbackUserInput: string): string {
  if (action.data.trim().length > 0) {
    return action.data
  }
  return fallbackUserInput
}

export async function* runMultiActionTurn(
  userInput: string,
  priorHistory: readonly ConversationEntry[],
): AsyncGenerator<AgentEvent> {
  yield { type: 'status', message: 'Starting your turn…' }

  const userInstructionDocuments = await loadAllUserInstructionDocuments()
  const userInstructionsBlock = formatUserInstructionsBlock(userInstructionDocuments)

  yield { type: 'status', message: 'Understanding your message…' }

  let classification
  try {
    classification = await classifyInputUnified(userInput, priorHistory, userInstructionsBlock)
  } catch (err) {
    logger.error({ err }, '[MultiActionOrchestrator] Classification failed')
    yield { type: 'error', message: toErrorMessage(err) }
    yield { type: 'done' }
    return
  }

  const actions = classification.actions
  logger.debug({ actionCount: actions.length, intents: actions.map((a) => a.intent) }, '[MultiActionOrchestrator] Classified')

  const outcomes: ActionOutcome[] = []
  const collectedDocumentIds: string[] = []
  const historyForHandlers = [...priorHistory]

  for (let index = 0; index < actions.length; index += 1) {
    const action = actions[index]
    const actionInput = buildActionInput(action, userInput)

    yield { type: 'status', message: actionToStatusLabel(action.intent) }

    let chunkContent = ''
    let hadError = false
    let errorMessage = ''
    let hadStored = false
    let hadDeleted = false

    try {
      const handler = selectHandler(action)
      for await (const event of handler(actionInput, action, historyForHandlers, userInstructionDocuments, userInstructionsBlock)) {
        if (event.type === 'chunk') {
          chunkContent += event.content
        }
        // Handlers yield `done` when their generator ends; the UI treats `done` as end-of-stream.
        // Buffering handler chunks and replaying them after the loop depends on streaming staying
        // open—only the orchestrator may emit the turn-level `done` to the renderer.
        if (event.type !== 'chunk' && event.type !== 'done') {
          yield event
        }
        if (event.type === 'stored') {
          hadStored = true
          collectedDocumentIds.push(event.documentId)
        }
        if (event.type === 'deleted') {
          hadDeleted = true
        }
        if (event.type === 'retrieved') {
          collectedDocumentIds.push(...event.documentIds)
        }
        if (event.type === 'error') {
          hadError = true
          errorMessage = event.message
        }
      }
    } catch (err) {
      hadError = true
      errorMessage = toErrorMessage(err)
      logger.error({ err, actionIndex: index }, '[MultiActionOrchestrator] Handler failed')
    }

    const status = hadError
      ? 'failed'
      : (action.intent === 'save' && hadStored) || (action.intent === 'delete' && hadDeleted)
        ? 'succeeded'
        : inferStatusFromMessage(chunkContent, action.intent)

    const message = hadError ? errorMessage : (chunkContent.trim() || 'Done.')
    outcomes.push({
      intent: action.intent,
      situationSummary: action.situationSummary,
      status,
      message,
    })
  }

  if (outcomes.length === 0) {
    yield { type: 'done' }
    return
  }

  const isSingleSpeak =
    outcomes.length === 1 && outcomes[0].intent === 'speak' && outcomes[0].message.length > 0
  if (isSingleSpeak) {
    yield { type: 'chunk', content: outcomes[0].message }
    yield { type: 'done' }
    return
  }

  yield { type: 'status', message: 'Composing your reply…' }

  for await (const chunk of streamAssistantUserReplyWithFallback({
    userInstructionsBlock,
    facts: { kind: 'multi_action_summary', outcomes },
  })) {
    yield { type: 'chunk', content: chunk }
  }

  yield { type: 'done' }
}

type HandlerInvocation = (
  actionInput: string,
  action: ClassificationAction,
  history: ConversationEntry[],
  userInstructionDocuments: readonly import('../../shared/types').LoreDocument[],
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
      return async function* (input, classification, history, instructionDocs, instructions) {
        const isShortGreeting = input.trim().length < 12
        const relevantInstructions = isShortGreeting
          ? []
          : await retrieveRelevantDocuments(input, {
              type: 'instruction',
              similarityThreshold: 0.8,
            })

        if (relevantInstructions.length > 0) {
          const isTodoQuery = classification.extractedTags.some((tag) => tag === 'todo')
          const todoOverrides = isTodoQuery ? ({ type: 'todo' } as const) : undefined
          yield* handleQuestion(input, classification, history, todoOverrides, instructionDocs, instructions)
        } else {
          yield* handleConversational(input, classification, history, instructions)
        }
      }
  }
}
