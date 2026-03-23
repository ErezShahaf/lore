import type { ClassificationResult, ConversationEntry, InputClassification } from '../../shared/types'
import { retrieveRelevantDocuments } from './documentPipeline'
import { classifyInputUnified } from './unifiedClassifierService'
import { loadSkill } from './skillLoader'

export const ROUTER_CLASSIFICATION_CONFIDENCE_THRESHOLD = 0.75

export type WorkerKind =
  | 'question'
  | 'thought'
  | 'command'
  | 'instruction'
  | 'conversational'
  | 'clarification'

const WORKER_TOOL_ALLOWLISTS: Readonly<Record<WorkerKind, readonly string[]>> = {
  question: ['search_for_question', 'get_document'],
  thought: ['save_documents', 'compose_reply', 'get_document'],
  command: ['search_for_command', 'modify_documents', 'compose_reply'],
  instruction: ['search_library', 'save_documents', 'compose_reply'],
  conversational: [],
  clarification: [],
}

export function getToolsForWorker(workerKind: WorkerKind): readonly string[] {
  return WORKER_TOOL_ALLOWLISTS[workerKind]
}

function intentToWorker(intent: Exclude<InputClassification, 'conversational'>): WorkerKind {
  switch (intent) {
    case 'thought':
      return 'thought'
    case 'question':
      return 'question'
    case 'command':
      return 'command'
    case 'instruction':
      return 'instruction'
  }
}

export async function resolveWorkerForTurn(
  userInput: string,
  priorHistory: readonly ConversationEntry[],
  userInstructionsBlock: string,
): Promise<{ workerKind: WorkerKind; classification: ClassificationResult }> {
  const classification = await classifyInputUnified(userInput, priorHistory, userInstructionsBlock)

  if (classification.confidence < ROUTER_CLASSIFICATION_CONFIDENCE_THRESHOLD) {
    return { workerKind: 'clarification', classification }
  }

  if (classification.intent === 'conversational') {
    const relevantInstructions = await retrieveRelevantDocuments(userInput, {
      type: 'instruction',
      similarityThreshold: classification.subtype === 'greeting' ? 0.55 : 0.8,
    })
    if (relevantInstructions.length > 0) {
      return { workerKind: 'question', classification }
    }
    return { workerKind: 'conversational', classification }
  }

  return {
    workerKind: intentToWorker(classification.intent),
    classification,
  }
}

function compactClassificationForPrompt(classification: ClassificationResult): string {
  return JSON.stringify({
    intent: classification.intent,
    subtype: classification.subtype,
    confidence: classification.confidence,
    extractedDate: classification.extractedDate,
    extractedTags: classification.extractedTags,
    situationSummary: classification.situationSummary,
    thoughtClarification: classification.thoughtClarification,
  })
}

export function buildWorkerSystemPrompt(
  workerKind: WorkerKind,
  userInstructionsBlock: string,
  classification: ClassificationResult,
): string {
  const workerSkillFileName = `skill-worker-${workerKind}` as const
  const parts: string[] = [
    loadSkill('skill-shared-protocol'),
    loadSkill(workerSkillFileName),
    [
      '## Router classification',
      'Align tool params with this summary; refine only if clearly wrong.',
      '',
      '```json',
      compactClassificationForPrompt(classification),
      '```',
    ].join('\n'),
  ]

  if (userInstructionsBlock.length > 0) {
    parts.push(`## Active user instructions\n\n${userInstructionsBlock}`)
  }

  return parts.join('\n\n---\n\n')
}

export function workerKindStatusLabel(workerKind: WorkerKind): string {
  switch (workerKind) {
    case 'question':
      return 'Question specialist…'
    case 'thought':
      return 'Save specialist…'
    case 'command':
      return 'Update specialist…'
    case 'instruction':
      return 'Preference specialist…'
    case 'conversational':
      return 'Conversation…'
    case 'clarification':
      return 'Asking for clarity…'
  }
}
