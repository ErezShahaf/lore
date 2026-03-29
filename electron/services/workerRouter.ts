import { WORKER_KIND_TO_SKILL_MOUNT_ID } from '../../shared/skillTreeSpec'
import {
  primaryClassificationAction,
  type ClassificationResult,
  type ConversationEntry,
  type InputClassification,
} from '../../shared/types'
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
): string {
  const workerSkillMountId = WORKER_KIND_TO_SKILL_MOUNT_ID[workerKind]
  const parts: string[] = [
    loadSkill('skill-shared-protocol'),
    loadSkill(workerSkillMountId),
    [
      '## Router classification',
      'Use intent, date, situation summary, and `saveDocumentType` from this JSON. `extractedTags` describe the turn for search-style hints; they are not a tag list to paste onto every row of `save_documents`. Each saved item needs tags derived from that item’s own `content`.',
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
