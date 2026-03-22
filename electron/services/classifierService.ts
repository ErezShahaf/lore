import { logger } from '../logger'
import type { AgentEvent, ClassificationResult, ConversationEntry } from '../../shared/types'
import { extractMetadata } from './metadataExtractionService'
import { routeIntent } from './intentRouteService'
import { synthesizeSituation } from './situationService'

export async function* classifyInputWithStatusEvents(
  userInput: string,
  conversationHistory: readonly ConversationEntry[] = [],
  userInstructionsBlock: string = '',
): AsyncGenerator<AgentEvent, ClassificationResult> {
  const now = new Date()

  yield { type: 'status', message: 'Summarizing conversation and situation…' }
  const situation = await synthesizeSituation(userInput, conversationHistory, userInstructionsBlock)

  yield { type: 'status', message: 'Routing intent…' }
  let route
  try {
    route = await routeIntent(situation, userInput, conversationHistory, userInstructionsBlock)
  } catch (err) {
    logger.error({ err }, '[Classifier] Intent routing failed')
    throw new Error(
      `Intent routing failed: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  yield { type: 'status', message: 'Extracting tags and dates…' }
  const metadata = await extractMetadata(
    route.intent,
    situation,
    userInput,
    conversationHistory,
    now,
    userInstructionsBlock,
  )

  return {
    intent: route.intent,
    subtype: metadata.subtype,
    extractedDate: metadata.extractedDate,
    extractedTags: metadata.extractedTags,
    confidence: route.confidence,
    reasoning: `${route.reasoning} | Metadata: subtype=${metadata.subtype}`,
    situationSummary: situation.situationSummary,
    thoughtClarification: metadata.thoughtClarification,
  }
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
