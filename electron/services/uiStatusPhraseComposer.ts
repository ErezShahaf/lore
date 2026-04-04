import { logger } from '../logger'
import { collectChatResponse } from './ollamaService'
import { loadSkill } from './skillLoader'
import { getSettings } from './settingsService'
import { appendUserInstructionsToSystemPrompt } from './userInstructionsContext'

export const UI_STATUS_FALLBACK_MESSAGE = 'Working…'

export interface UiStatusPhraseRequest {
  readonly phase: string
  readonly intent?: 'save' | 'read' | 'edit' | 'delete' | 'speak'
  readonly matchingNoteCount?: number
  readonly stepIndex?: number
  readonly totalSteps?: number
  readonly toolAgent?: string
  readonly orchestratorLoopStep?: number
}

export const UiStatusPhase = {
  workingOnMessage: 'working_on_message',
  figuringOutNeed: 'figuring_out_need',
  classifyingRequest: 'classifying_request',
  listingOptions: 'listing_options',
  summarizingTurn: 'summarizing_turn',
  multiActionStep: 'multi_action_step',
  searchingNotes: 'searching_notes',
  searchingLibraryForCommand: 'searching_library_for_command',
  narrowingCommandTargets: 'narrowing_command_targets',
  commandExecutingUpdate: 'command_executing_update',
  commandExecutingDelete: 'command_executing_delete',
  commandExecutingBatch: 'command_executing_batch',
  pullingAnswerTogether: 'pulling_answer_together',
  choosingAnswerPath: 'choosing_answer_path',
  writingAnswerFromNotes: 'writing_answer_from_notes',
  noMatchDraftingAnswer: 'no_match_drafting_answer',
  draftingNaturalReply: 'drafting_natural_reply',
  checkingSimilarInstruction: 'checking_similar_instruction',
  savingInstruction: 'saving_instruction',
  checkingDuplicateSave: 'checking_duplicate_save',
  savingToLibrary: 'saving_to_library',
  updatingExistingNote: 'updating_existing_note',
  orchestratorSavingNote: 'orchestrator_saving_note',
  orchestratorReadingLibrary: 'orchestrator_reading_library',
  orchestratorApplyingChanges: 'orchestrator_applying_changes',
  orchestratorCheckingInstructions: 'orchestrator_checking_instructions',
  orchestratorAnsweringFromSavedInstructions: 'orchestrator_answering_from_saved_instructions',
  orchestratorNoRuleDrafting: 'orchestrator_no_rule_drafting',
  workerFocusQuestion: 'worker_focus_question',
  workerFocusThought: 'worker_focus_thought',
  workerFocusCommand: 'worker_focus_command',
  workerFocusConversational: 'worker_focus_conversational',
  workerFocusUnified: 'worker_focus_unified',
  toolSearchLibrary: 'tool_search_library',
  toolSearchForQuestion: 'tool_search_for_question',
  toolSearchForCommand: 'tool_search_for_command',
  toolGetDocument: 'tool_get_document',
  toolSaveDocuments: 'tool_save_documents',
  toolModifyDocuments: 'tool_modify_documents',
  toolComposeReply: 'tool_compose_reply',
  toolSummarizeContext: 'tool_summarize_context',
  orchestratorDecidingNext: 'orchestrator_deciding_next',
  orchestratorAnotherPass: 'orchestrator_another_pass',
  toolRunningUnknown: 'tool_running_unknown',
} as const

const STATUS_MAX_OUTPUT_CHARS = 72
const CACHE_MAX_ENTRIES = 128

let cacheOrder: string[] = []

const phraseCache = new Map<string, string>()

export function resetUiStatusPhraseCacheForNewTurn(): void {
  phraseCache.clear()
  cacheOrder = []
}

function buildCacheKey(request: UiStatusPhraseRequest): string {
  return JSON.stringify({
    phase: request.phase,
    intent: request.intent ?? null,
    matchingNoteCount: request.matchingNoteCount ?? null,
    stepIndex: request.stepIndex ?? null,
    totalSteps: request.totalSteps ?? null,
    toolAgent: request.toolAgent ?? null,
    orchestratorLoopStep: request.orchestratorLoopStep ?? null,
  })
}

function rememberInCache(key: string, value: string): void {
  if (phraseCache.has(key)) {
    phraseCache.delete(key)
    cacheOrder = cacheOrder.filter((entry) => entry !== key)
  }
  phraseCache.set(key, value)
  cacheOrder = [...cacheOrder, key]
  while (cacheOrder.length > CACHE_MAX_ENTRIES) {
    const oldest = cacheOrder[0]
    if (oldest === undefined) {
      break
    }
    cacheOrder = cacheOrder.slice(1)
    phraseCache.delete(oldest)
  }
}

function sanitizePhrase(raw: string): string {
  const singleLine = raw.replace(/\s+/g, ' ').trim()
  const trimmedEnds = singleLine.replace(/^[`"']+|[`"']+$/g, '').trim()
  if (trimmedEnds.length <= STATUS_MAX_OUTPUT_CHARS) {
    return trimmedEnds
  }
  return `${trimmedEnds.slice(0, Math.max(1, STATUS_MAX_OUTPUT_CHARS - 1))}…`
}

export async function resolveUiStatusMessage(input: {
  readonly request: UiStatusPhraseRequest
  readonly userInstructionsBlock: string
}): Promise<string> {
  const key = buildCacheKey(input.request)
  const cached = phraseCache.get(key)
  if (cached !== undefined) {
    return cached
  }

  const settings = getSettings()
  const systemPrompt = appendUserInstructionsToSystemPrompt(
    loadSkill('ui-status-phrase'),
    input.userInstructionsBlock,
  )
  const userContent = [
    'STATUS_JSON:',
    JSON.stringify(input.request),
    '',
    'Reply with the status line only.',
  ].join('\n')

  try {
    const raw = await collectChatResponse({
      model: settings.selectedModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      stream: false,
      think: false,
      options: { num_predict: 48 },
    })
    const phrase = sanitizePhrase(raw)
    if (phrase.length === 0) {
      logger.warn({ request: input.request }, '[UiStatusPhrase] Empty model phrase')
      rememberInCache(key, UI_STATUS_FALLBACK_MESSAGE)
      return UI_STATUS_FALLBACK_MESSAGE
    }
    rememberInCache(key, phrase)
    return phrase
  } catch (error) {
    logger.error({ error, request: input.request }, '[UiStatusPhrase] Model failed')
    rememberInCache(key, UI_STATUS_FALLBACK_MESSAGE)
    return UI_STATUS_FALLBACK_MESSAGE
  }
}
