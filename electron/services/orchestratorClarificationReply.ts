import { loadSkill } from './skillLoader'
import { appendUserInstructionsToSystemPrompt } from './userInstructionsContext'
import { streamQuestionLlmChunks } from './questionAnswerComposition'

/**
 * When classification confidence is low, draft a reply via the same model path as questions
 * so standing instructions apply consistently.
 */
const LOW_CONFIDENCE_RECENT_TURNS_MAX = 4
const LOW_CONFIDENCE_RECENT_CHARS_MAX = 2500

function formatRecentConversationForLowConfidence(
  turns: ReadonlyArray<{ readonly role: 'user' | 'assistant'; readonly content: string }>,
): string | null {
  if (turns.length === 0) {
    return null
  }
  const tail = turns.slice(-LOW_CONFIDENCE_RECENT_TURNS_MAX)
  const lines = tail.map((entry) => `${entry.role}: ${entry.content.trim()}`)
  let body = lines.join('\n\n')
  if (body.length > LOW_CONFIDENCE_RECENT_CHARS_MAX) {
    body = body.slice(-LOW_CONFIDENCE_RECENT_CHARS_MAX)
  }
  return body
}

export async function* streamLowConfidenceOrchestratorReply(input: {
  readonly userInput: string
  readonly userInstructionsBlock: string
  readonly model: string
  readonly recentConversation?: ReadonlyArray<{
    readonly role: 'user' | 'assistant'
    readonly content: string
  }>
}): AsyncGenerator<string> {
  const systemPrompt = appendUserInstructionsToSystemPrompt(
    loadSkill('orchestrator-low-confidence'),
    input.userInstructionsBlock,
  )

  const recentBlock = formatRecentConversationForLowConfidence(input.recentConversation ?? [])

  const userMessage = [
    'Lore could not confidently classify what the user wants to do next.',
    '',
    ...(recentBlock !== null
      ? ['Recent conversation (latest turns, truncated if long):', recentBlock, '']
      : []),
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
