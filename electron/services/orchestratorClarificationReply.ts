import { loadSkill } from './skillLoader'
import { appendUserInstructionsToSystemPrompt } from './userInstructionsContext'
import { streamQuestionLlmChunks } from './questionAnswerComposition'

/**
 * When classification confidence is low, draft a reply via the same model path as questions
 * so standing instructions apply consistently.
 */
export async function* streamLowConfidenceOrchestratorReply(input: {
  readonly userInput: string
  readonly userInstructionsBlock: string
  readonly model: string
}): AsyncGenerator<string> {
  const systemPrompt = appendUserInstructionsToSystemPrompt(
    loadSkill('orchestrator-low-confidence'),
    input.userInstructionsBlock,
  )

  const userMessage = [
    'Lore could not confidently classify what the user wants to do next.',
    '',
    'User message:',
    input.userInput,
    '',
    'Reply briefly: invite them to rephrase or add detail, and mention they can ask what Lore can do. Follow User standing instructions in the system prompt for tone or exact phrasing when specified.',
  ].join('\n')

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ]

  yield* streamQuestionLlmChunks(input.model, messages)
}
