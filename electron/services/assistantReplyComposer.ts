import { logger } from '../logger'
import { loadSkill } from './skillLoader'
import { getSettings } from './settingsService'
import { appendUserInstructionsToSystemPrompt } from './userInstructionsContext'
import { streamQuestionLlmChunks } from './questionAnswerComposition'
import type { AssistantReplyFacts } from './assistantReplyTypes'

export async function* streamAssistantUserReply(input: {
  readonly facts: AssistantReplyFacts
  readonly userInstructionsBlock: string
  readonly model: string
}): AsyncGenerator<string> {
  const systemPrompt = appendUserInstructionsToSystemPrompt(
    loadSkill('assistant-user-reply'),
    input.userInstructionsBlock,
  )

  const userMessage = [
    'Lore has finished an action. Below is FACTS_JSON — the only ground truth about what happened.',
    'Write the message the user should see. Do not contradict FACTS_JSON.',
    '',
    'FACTS_JSON:',
    JSON.stringify(input.facts, null, 2),
  ].join('\n')

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ]

  yield* streamQuestionLlmChunks(input.model, messages)
}

/**
 * Streams the composed reply, or a deterministic fallback if the model fails.
 */
export async function* streamAssistantUserReplyWithFallback(input: {
  readonly facts: AssistantReplyFacts
  readonly userInstructionsBlock: string
}): AsyncGenerator<string> {
  const settings = getSettings()
  try {
    yield* streamAssistantUserReply({
      facts: input.facts,
      userInstructionsBlock: input.userInstructionsBlock,
      model: settings.selectedModel,
    })
  } catch (error) {
    logger.error({ error }, '[AssistantReplyComposer] Model failed; using fallback text')
    yield buildFallbackAssistantReply(input.facts)
  }
}

export function buildFallbackAssistantReply(facts: AssistantReplyFacts): string {
  switch (facts.kind) {
    case 'thought_saved_single': {
      const dup = facts.hadDuplicate && facts.duplicatePreview
        ? ` (similar to something you already had: "${facts.duplicatePreview.slice(0, 80)}${facts.duplicatePreview.length > 80 ? '…' : ''}")`
        : ''
      return `Saved your ${facts.documentType}${dup}.`
    }
    case 'thought_saved_many': {
      const label =
        facts.todoItemCount === facts.itemCount && facts.itemCount > 0
          ? 'todos'
          : facts.todoItemCount > 0
            ? 'items'
            : 'notes'
      const dup =
        facts.duplicateCount > 0 ? ` ${facts.duplicateCount} seemed similar to existing notes.` : ''
      return `Saved ${facts.itemCount} ${label}.${dup}`
    }
    case 'instruction_stored': {
      const extra =
        facts.similarInstructionPreviews.length > 0
          ? ` Similar instructions already saved: ${facts.similarInstructionPreviews.join('; ')}.`
          : ''
      return `Saved your instruction.${extra}`
    }
    case 'command_no_documents':
      return 'No matching documents were found in your library.'
    case 'command_no_match':
      return 'Could not match your request to stored documents.'
    case 'command_executed': {
      if (facts.operations.length === 0) return 'No changes were made.'
      const parts = facts.operations.map((operation) => {
        const preview = operation.contentPreview
        return operation.action === 'delete' ? `removed "${preview}"` : `updated "${preview}"`
      })
      return `Done: ${parts.join(', ')}.`
    }
    default: {
      return 'Done.'
    }
  }
}
