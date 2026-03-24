import { logger } from '../logger'
import { classifyInputUnified } from './unifiedClassifierService'
import {
  buildClassificationActionInput,
  classificationIntentStatusLabel,
  executeClassificationAction,
} from './classificationActionExecutor'
import { formatUserInstructionsBlock, loadAllUserInstructionDocuments } from './userInstructionsContext'
import { streamAssistantUserReplyWithFallback } from './assistantReplyComposer'
import type { AgentEvent, ActionOutcome, ConversationEntry } from '../../shared/types'

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected error occurred'
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
  const historyForHandlers = [...priorHistory]
  let streamedSpeakChunksForLastAction = false

  for (let index = 0; index < actions.length; index += 1) {
    const action = actions[index]
    const actionInput = buildClassificationActionInput(action, userInput)

    yield { type: 'status', message: classificationIntentStatusLabel(action.intent) }

    streamedSpeakChunksForLastAction = false

    const executor = executeClassificationAction({
      action,
      actionInput,
      actionIndex: index,
      conversationHistory: historyForHandlers,
      userInstructionDocuments,
      userInstructionsBlock,
    })

    let step = await executor.next()
    while (!step.done) {
      const event = step.value
      if (event.type === 'chunk' && action.intent === 'speak') {
        streamedSpeakChunksForLastAction = true
      }
      yield event
      step = await executor.next()
    }

    const outcome = step.value
    outcomes.push(outcome)
  }

  if (outcomes.length === 0) {
    yield { type: 'done' }
    return
  }

  const isSingleSpeak =
    outcomes.length === 1 && outcomes[0].intent === 'speak' && outcomes[0].message.length > 0
  if (isSingleSpeak) {
    if (!streamedSpeakChunksForLastAction) {
      yield { type: 'chunk', content: outcomes[0].message }
    }
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
