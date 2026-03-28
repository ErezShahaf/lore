import { logger } from '../logger'
import { loadSkill } from './skillLoader'
import { getSettings } from './settingsService'
import { appendUserInstructionsToSystemPrompt } from './userInstructionsContext'
import { streamQuestionLlmChunks } from './questionAnswerComposition'
import type { AssistantReplyFacts } from './assistantReplyTypes'

const DUPLICATE_FALLBACK_EXISTING_NOTE_MAX_CHARS = 50_000

function formatDuplicateExistingNoteBlockForFallback(existingContent: string): string {
  const trimmed = existingContent.trim()
  const body =
    trimmed.length > DUPLICATE_FALLBACK_EXISTING_NOTE_MAX_CHARS
      ? `${trimmed.slice(0, DUPLICATE_FALLBACK_EXISTING_NOTE_MAX_CHARS)}…`
      : trimmed
  if (body.length === 0) {
    return '> (empty)'
  }
  return body
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
}

type MultiActionSummaryOutcome = Extract<
  AssistantReplyFacts,
  { readonly kind: 'multi_action_summary' }
>['outcomes'][number]

function tryBuildDeterministicAllSuccessfulTodoSavesReply(
  outcomes: readonly MultiActionSummaryOutcome[],
): string | null {
  if (outcomes.length === 0) {
    return null
  }

  const everyOutcomeIsSuccessfulTodoSave = outcomes.every(
    (outcome) =>
      outcome.intent === 'save'
      && outcome.saveDocumentType === 'todo'
      && outcome.status === 'succeeded'
      && outcome.storedDocumentIds.length > 0,
  )

  if (!everyOutcomeIsSuccessfulTodoSave) {
    return null
  }

  const count = outcomes.length
  const todoWord = count === 1 ? 'todo' : 'todos'
  return `Saved ${count} ${todoWord}.`
}

function tryBuildPassThroughStructuredReadReply(
  outcomes: readonly MultiActionSummaryOutcome[],
): string | null {
  if (outcomes.length !== 1) {
    return null
  }

  const outcome = outcomes[0]
  if (outcome.intent !== 'read' || outcome.status !== 'succeeded') {
    return null
  }

  const trimmedMessage = outcome.message.trim()
  if (trimmedMessage.startsWith('```')) {
    return outcome.message
  }
  if (trimmedMessage.includes('```')) {
    return outcome.message
  }

  return null
}

export async function* streamAssistantUserReply(input: {
  readonly facts: AssistantReplyFacts
  readonly userInstructionsBlock: string
  readonly model: string
}): AsyncGenerator<string> {
  const systemPrompt = appendUserInstructionsToSystemPrompt(
    loadSkill('assistant-user-reply', { kind: input.facts.kind }),
    input.userInstructionsBlock,
  )

  const multiActionLead =
    input.facts.kind === 'multi_action_summary'
      ? [
          `The user’s exact message this turn: ${input.facts.turnUserMessage}`,
          'Your job: produce the reply they should see. For any read outcome with a non-empty `retrievedDocumentsForComposer`, those `content` fields are the full stored notes—include that text in full (blockquote prose with `> ` per line; fenced code blocks for JSON/XML/YAML/code) when they asked for the note, article, full text, or read-back—unless they clearly asked only for a summary or gist. Do not replace that with a meta line like “here is what the article is about” without the actual body.',
          'FACTS_JSON also includes a `turnUserMessage` field; it duplicates the line above for parsers.',
          '',
        ].join('\n')
      : ''

  const userMessage = [
    multiActionLead
      + 'Lore has finished an action. Below is FACTS_JSON — the only ground truth about what happened.',
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

  if (input.facts.kind === 'multi_action_summary') {
    const deterministic = tryBuildDeterministicAllSuccessfulTodoSavesReply(input.facts.outcomes)
    if (deterministic !== null) {
      yield deterministic
      return
    }

    const structuredRead = tryBuildPassThroughStructuredReadReply(input.facts.outcomes)
    if (structuredRead !== null) {
      yield structuredRead
      return
    }
  }

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
      const preview =
        facts.storedContentPreview && facts.storedContentPreview.trim().length > 0
          ? ` Content stored (excerpt): ${facts.storedContentPreview.slice(0, 200)}${facts.storedContentPreview.length > 200 ? '…' : ''}`
          : ''
      return `Saved your ${facts.documentType}${dup}.${preview}`
    }
    case 'duplicate_save_clarification_pending': {
      const existing = formatDuplicateExistingNoteBlockForFallback(facts.existingNoteContent)
      return [
        'You may already have the same (or almost the same) note. Here is what is on file:',
        '',
        existing,
        '',
        'Tell me if you want to keep a second copy alongside the existing note, or replace the existing one.',
      ].join('\n')
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
    case 'multi_action_summary': {
      const succeeded = facts.outcomes.filter((outcome) => outcome.status === 'succeeded')
      const failed = facts.outcomes.filter((outcome) => outcome.status === 'failed')
      const parts: string[] = []
      if (succeeded.length > 0) {
        parts.push(
          succeeded
            .map((outcome) => `${outcome.handlerResultSummary} User-facing text: ${outcome.message}`)
            .join(' '),
        )
      }
      if (failed.length > 0) {
        const failPhrase = succeeded.length > 0 ? ' However, ' : ''
        parts.push(
          failPhrase
            + failed
              .map((outcome) => `${outcome.handlerResultSummary} (${outcome.message})`)
              .join(' '),
        )
      }
      return parts.length > 0 ? parts.join('') : 'Done.'
    }
    default: {
      return 'Done.'
    }
  }
}
