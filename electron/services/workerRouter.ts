import { WORKER_KIND_TO_SKILL_MOUNT_ID } from '../../shared/skillTreeSpec'
import {
  primaryClassificationAction,
  type ClassificationResult,
  type ConversationEntry,
  type InputClassification,
} from '../../shared/types'
import { retrieveRelevantDocuments } from './documentPipeline'
import { buildLayeredWorkerSystemPrompt } from './promptLayers'
import { classifyInputUnified } from './unifiedClassifierService'
import { loadSkill, type SkillPromptSelectors } from './skillLoader'

export type WorkerKind =
  | 'question'
  | 'thought'
  | 'command'
  | 'conversational'
  | 'unified'

/** How the worker prompt describes tools: JSON-in-text (`skill-shared-protocol`) vs native-tool wording (`skill-native-tool-protocol`). Lore's native tool loop uses JSON-in-text and dispatches tools in application code. */
export type WorkerToolOrchestrationProtocol = 'json_in_text' | 'ollama_native'

export interface BuildWorkerSystemPromptOptions {
  readonly workerToolOrchestrationProtocol?: WorkerToolOrchestrationProtocol
}

const WORKER_TOOL_ALLOWLISTS: Readonly<Record<WorkerKind, readonly string[]>> = {
  question: ['search_for_question', 'get_document'],
  thought: ['save_documents', 'compose_reply', 'get_document'],
  command: ['search_for_command', 'modify_documents', 'compose_reply'],
  conversational: [],
  unified: [
    'get_document',
    'modify_documents',
    'save_documents',
    'search_for_command',
    'search_for_question',
    'summarize_context',
  ],
}

export function getToolsForWorker(workerKind: WorkerKind): readonly string[] {
  return WORKER_TOOL_ALLOWLISTS[workerKind]
}

/**
 * Passed to `buildWorkerSystemPrompt` for `workerKind === 'unified'` only; routing text comes from the unified skill and static block, not this object.
 */
export const UNIFIED_NATIVE_IGNORED_CLASSIFICATION_PLACEHOLDER: ClassificationResult = {
  actions: [
    {
      intent: 'speak',
      extractedDate: null,
      extractedTags: [],
      situationSummary: 'Unified native tool loop; classification placeholder is ignored.',
      data: '',
      saveDocumentType: null,
    },
  ],
}

function intentToWorker(intent: Exclude<InputClassification, 'speak'>): WorkerKind {
  switch (intent) {
    case 'save':
      return 'thought'
    case 'read':
      return 'question'
    case 'edit':
      return 'command'
    case 'delete':
      return 'command'
  }
}

export async function resolveWorkerForTurn(
  userInput: string,
  priorHistory: readonly ConversationEntry[],
  userInstructionsBlock: string,
): Promise<{ workerKind: WorkerKind; classification: ClassificationResult }> {
  const classification = await classifyInputUnified(userInput, priorHistory, userInstructionsBlock)
  const primary = primaryClassificationAction(classification)

  if (primary.intent === 'speak') {
    const relevantInstructions = await retrieveRelevantDocuments(userInput, {
      type: 'instruction',
      similarityThreshold: 0.8,
    })
    if (relevantInstructions.length > 0) {
      return { workerKind: 'question', classification }
    }
    return { workerKind: 'conversational', classification }
  }

  return {
    workerKind: intentToWorker(primary.intent),
    classification,
  }
}

function compactClassificationForPrompt(classification: ClassificationResult): string {
  const primary = primaryClassificationAction(classification)
  return JSON.stringify({
    intent: primary.intent,
    extractedDate: primary.extractedDate,
    extractedTags: primary.extractedTags,
    situationSummary: primary.situationSummary,
    saveDocumentType: primary.saveDocumentType,
    data: primary.data,
  })
}

export function buildWorkerSystemPrompt(
  workerKind: WorkerKind,
  userInstructionsBlock: string,
  classification: ClassificationResult,
  options: BuildWorkerSystemPromptOptions = {},
): string {
  const workerToolOrchestrationProtocol = options.workerToolOrchestrationProtocol ?? 'json_in_text'
  const protocolSkillId =
    workerToolOrchestrationProtocol === 'ollama_native' ? 'skill-native-tool-protocol' : 'skill-shared-protocol'

  const workerSkillSelectors: SkillPromptSelectors =
    workerToolOrchestrationProtocol === 'ollama_native'
    && workerKind !== 'conversational'
    && workerKind !== 'unified'
      ? { toolOrchestration: 'ollama_native' }
      : {}

  const userBlock =
    userInstructionsBlock.trim().length > 0
      ? `## Active user instructions\n\n${userInstructionsBlock}`
      : ''

  if (workerKind === 'unified') {
    const unifiedRoutingBlock = [
      '## Routing',
      '',
      'There is **no** pre-router classification JSON for this turn. Infer intent from the user message and conversation history.',
      '',
      '- Questions that could be about **their saved material** (who/what/when/do I have/remember…): your **first** step must be `search_for_question` with a concrete **`query`**—never a chatty `reply` that offers general-world help or ignores the library.',
      '- Library questions: keep using `search_for_question` with an explicit **`query`** when possible (optional `type`, `maxResults`). That reduces reliance on host-side fallback classification.',
      '- Retrieval: `search_for_question` returns **snippets** (`contentSnippet`, `contentTruncated`). For full bodies—especially JSON, code, or long notes—call `get_document` with the hit’s `id`. Default to **verbatim** stored text for find/show requests unless the user explicitly asked for a summary.',
      '- Save flows: infer `save_documents` item **`type`** (todo, note, meeting, instruction, thought); do **not** ask todo vs note when the content makes it obvious. After tools succeed, **you** draft the final user message from tool JSON (`reply` / `stream_result`)—there is no `compose_reply` tool in this path.',
      '- Edit/delete: `search_for_command` then `modify_documents` when safe; then **you** draft the final message from tool results. Use **verbatim** numbered candidates when clarifying targets.',
      '- Optional: `summarize_context` to shrink long retrieved text for your next tool step—not a substitute for verbatim read-back unless the user asked for a summary.',
      '- Final answer: prefer `{"action":"stream_result"}` for streamed markdown (host runs a second completion); use `{"action":"reply","content":"..."}` for very short text only.',
    ].join('\n')

    return buildLayeredWorkerSystemPrompt({
      protocol: loadSkill(protocolSkillId),
      workerInstructions: loadSkill('skill-native-unified-agent', workerSkillSelectors),
      routerClassificationJson: unifiedRoutingBlock,
      userInstructionsBlock: userBlock,
    })
  }

  const workerSkillMountId = WORKER_KIND_TO_SKILL_MOUNT_ID[workerKind]
  const routerClassificationJson = [
    '## Router classification',
    'Use intent, date, situation summary, and `saveDocumentType` from this JSON. `extractedTags` describe the turn for search-style hints; they are not a tag list to paste onto every row of `save_documents`. Each saved item needs tags derived from that item’s own `content`.',
    '',
    '```json',
    compactClassificationForPrompt(classification),
    '```',
  ].join('\n')

  return buildLayeredWorkerSystemPrompt({
    protocol: loadSkill(protocolSkillId),
    workerInstructions: loadSkill(workerSkillMountId, workerSkillSelectors),
    routerClassificationJson,
    userInstructionsBlock: userBlock,
  })
}

/**
 * Optional reply-style reference for thought/command (classic tool workers use `compose_reply`).
 * Unified native loop has no `compose_reply`; it does not load this addon.
 */
export function loadProgressiveComposeSkillAddon(workerKind: WorkerKind): string {
  if (workerKind === 'thought' || workerKind === 'command') {
    return loadSkill('assistant-user-reply')
  }
  return ''
}
