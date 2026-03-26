import type { AgentEvent, ClassificationResult, ConversationEntry } from '../../shared/types'
import { classifyInputUnified } from './unifiedClassifierService'

export async function* classifyInputWithStatusEvents(
  userInput: string,
  conversationHistory: readonly ConversationEntry[] = [],
  userInstructionsBlock: string = '',
): AsyncGenerator<AgentEvent, ClassificationResult> {
  yield { type: 'status', message: 'Figuring out what kind of request this is…' }
  return classifyInputUnified(userInput, conversationHistory, userInstructionsBlock)
}

export async function classifyInput(
  userInput: string,
  conversationHistory: readonly ConversationEntry[] = [],
  userInstructionsBlock: string = '',
): Promise<ClassificationResult> {
  const iterator = classifyInputWithStatusEvents(userInput, conversationHistory, userInstructionsBlock)
  let step = await iterator.next()
  while (!step.done) {
    step = await iterator.next()
  }
  return step.value as ClassificationResult
}
