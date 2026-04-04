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
          'Your job: produce the reply they should see.',
          'Read outcomes: `outcomes[].message` is the handler’s draft (often already the right answer). Prefer reusing or lightly editing it when it is consistent with `handlerResultSummary` and the user question.',
          'When `retrievedDocumentsForComposer` is non-empty: use only notes that **genuinely answer** `turnUserMessage`. For pointed questions (“which X”, “the one for Y”, a specific id or label), include **only** the matching material—do **not** paste unrelated rows that merely share a broad tag or topic.',
          'When they clearly want a **full read-back** of one or more notes (verbatim article, entire JSON blob, “show everything you found”), then include full `content` (blockquote prose with `> ` per line; fenced blocks for JSON/XML/YAML/code). If they asked only for a summary or gist, keep it short.',
          'When one turn **retrieved todos** and the same message sets a **standing instruction** (for example list order), still **include the todo list** in the reply; a brief acknowledgment of the rule is fine, but do not substitute meta-only “from now on…” text for the list they asked to see.',
          'Do not answer with only “I retrieved…” when they asked to see stored text—unless nothing matched.',
          'FACTS_JSON also includes a `turnUserMessage` field; it duplicates the first line above for parsers.',
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

export async function composeAssistantUserReplyText(input: {
  readonly facts: AssistantReplyFacts
  readonly userInstructionsBlock: string
}): Promise<string> {
  let text = ''
  for await (const chunk of streamAssistantUserReplyWithFallback(input)) {
    text += chunk
  }
  return text.trim()
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
      const bodies = facts.existingSimilarContents.filter((body) => body.trim().length > 0)
      const count = bodies.length
      if (count === 0) {
        return [
          'Something similar may already be in your library, but no preview was available.',
          '',
          'Nothing new was saved yet. Say if you want to save another copy anyway, or replace an existing match.',
        ].join('\n')
      }
      const intro =
        count <= 1
          ? 'You may already have the same (or almost the same) item. Here is what is on file:'
          : `You already have ${count} similar items that may match. Here they are:`
      const blocks = bodies.map((body, index) => {
        const label = count > 1 ? `Similar item ${index + 1}:\n\n` : ''
        return label + formatDuplicateExistingNoteBlockForFallback(body)
      })
      return [
        intro,
        '',
        blocks.join('\n\n---\n\n'),
        '',
        'Nothing new was saved yet. Say if you want to save another copy anyway, or replace the first listed match with this text.',
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
    case 'save_input_empty': {
      if (facts.emptyReason === 'empty_multi_action_step') {
        return 'Nothing to save for this step.'
      }
      return 'Nothing to save.'
    }
    case 'save_duplicate_replace_blocked':
      return 'Nothing to update.'
    case 'save_body_clarify_structured_intent':
      return [
        'You sent structured data without saying what to do with it.',
        'Should I save it as a note, help you find something in your library, or answer a question about it?',
      ].join(' ')
    case 'save_body_clarify_short_title':
      return [
        'Before I save it, what should I call this, or do you want a one-line description?',
        'That makes it easier to find later—I can use it in the title or tags.',
      ].join(' ')
    case 'command_resolution_failed':
      return 'Could not safely match your request to stored notes. Try being more specific.'
    case 'command_target_clarify': {
      const verb = facts.commandIntent === 'delete' ? 'remove' : 'change'
      return [
        `More than one item could match; say which one you want to ${verb}.`,
        '',
        facts.verbatimNumberedOptionsBlock,
        '',
        'Reply with the number or paste the exact wording of the item you mean.',
      ].join('\n')
    }
    case 'command_clarify_uncertain': {
      if (facts.hint && facts.hint.trim().length > 0) {
        return `I am not confident which document you mean (${facts.hint}). Could you narrow it down?`
      }
      return 'I am not sure which documents you mean. Could you be more specific?'
    }
    case 'command_clarify_model_text':
      return facts.text.trim().length > 0 ? facts.text : 'Could you clarify which stored item you mean?'
    case 'orchestrator_surface_fallback': {
      if (facts.trigger === 'max_steps_exhausted') {
        return 'I am having trouble finishing that request. Could you try rephrasing it?'
      }
      return 'I had trouble generating a response. Please try again or rephrase your request.'
    }
    case 'todo_list_present': {
      const greeting = facts.shouldEchoGreeting ? `${facts.userSurfaceInput.trim()}\n\n` : ''
      return `${greeting}${facts.bulletLines.join('\n')}`
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
