import type { ClassificationResult, ConversationEntry, InputClassification } from '../../shared/types'
import { retrieveRelevantDocuments } from './documentPipeline'
import { classifyInputUnified } from './unifiedClassifierService'
import { loadSkill } from './skillLoader'

export type WorkerKind =
  | 'question'
  | 'thought'
  | 'command'
  | 'conversational'

const WORKER_TOOL_ALLOWLISTS: Readonly<Record<WorkerKind, readonly string[]>> = {
  question: ['search_for_question', 'get_document'],
  thought: ['save_documents', 'compose_reply', 'get_document'],
  command: ['search_for_command', 'modify_documents', 'compose_reply'],
  conversational: [],
}

export function getToolsForWorker(workerKind: WorkerKind): readonly string[] {
  return WORKER_TOOL_ALLOWLISTS[workerKind]
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

  if (classification.intent === 'speak') {
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
    workerKind: intentToWorker(classification.intent),
    classification,
  }
}

function compactClassificationForPrompt(classification: ClassificationResult): string {
  return JSON.stringify({
    intent: classification.intent,
    extractedDate: classification.extractedDate,
    extractedTags: classification.extractedTags,
    situationSummary: classification.situationSummary,
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
    case 'conversational':
      return 'Conversation…'
  }
}
