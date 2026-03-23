import { logger } from '../logger'
import { collectChatResponse, parseJsonFromModelResponse } from './ollamaService'
import { getSettings } from './settingsService'
import { formatUserInstructionsBlock, loadAllUserInstructionDocuments } from './userInstructionsContext'
import {
  executeOrchestratorTool,
  type OrchestratorToolContext,
} from './orchestratorTools'
import {
  buildWorkerSystemPrompt,
  getToolsForWorker,
  resolveWorkerForTurn,
  workerKindStatusLabel,
  type WorkerKind,
} from './workerRouter'
import {
  ORCHESTRATOR_MAX_STEPS,
  type AgentEvent,
  type ConversationEntry,
  type OrchestratorAction,
} from '../../shared/types'

function conversationHistoryToMessages(
  history: readonly ConversationEntry[],
): Array<{ role: 'user' | 'assistant'; content: string }> {
  return history.map((entry) => ({
    role: entry.role,
    content: entry.content,
  }))
}

function parseOrchestratorAction(raw: string): OrchestratorAction | null {
  const parsed = parseJsonFromModelResponse(raw)
  if (!parsed || typeof parsed.action !== 'string') return null

  const action = parsed.action as string
  if (action === 'reply') {
    const content = typeof parsed.content === 'string' ? parsed.content : String(parsed.content ?? '')
    return { action: 'reply', content }
  }

  if (action === 'call') {
    const agent = typeof parsed.agent === 'string' ? parsed.agent : ''
    if (!agent) return null
    const params =
      parsed.params && typeof parsed.params === 'object' && !Array.isArray(parsed.params)
        ? (parsed.params as Record<string, unknown>)
        : {}
    return { action: 'call', agent, params }
  }

  return null
}

function formatToolResultForNextMessage(agent: string, output: string): string {
  return `[Result from ${agent}]: ${output}`
}

function formatValidAgentsHint(workerKind: WorkerKind, validAgentNames: ReadonlySet<string>): string {
  if (validAgentNames.size === 0) {
    return 'You cannot call tools in this mode. Respond with exactly {"action":"reply","content":"..."} only.'
  }
  return `Valid agents for this worker (${workerKind}): ${[...validAgentNames].sort().join(', ')}.`
}

function jsonRetryUserMessage(workerKind: WorkerKind, validAgentNames: ReadonlySet<string>): string {
  const base =
    'Your last response was not valid JSON. Respond with exactly one JSON object: either {"action":"call","agent":"<name>","params":{...}} or {"action":"reply","content":"..."}. Try again.'
  return `${base} ${formatValidAgentsHint(workerKind, validAgentNames)}`
}

export interface ToolOrchestratorTurnResult {
  assistantResponse: string
  lastDocumentIds: string[]
}

export async function* runToolOrchestratedTurn(
  userInput: string,
  priorHistory: readonly ConversationEntry[],
): AsyncGenerator<AgentEvent> {
  yield { type: 'status', message: 'Starting your turn…' }

  const settings = getSettings()
  const model = settings.selectedModel

  const userInstructionDocuments = await loadAllUserInstructionDocuments()
  const userInstructionsBlock = formatUserInstructionsBlock(userInstructionDocuments)

  yield { type: 'status', message: 'Understanding your message…' }

  let workerKind: WorkerKind
  let routerClassification: Awaited<ReturnType<typeof resolveWorkerForTurn>>['classification']

  try {
    const resolved = await resolveWorkerForTurn(userInput, priorHistory, userInstructionsBlock)
    workerKind = resolved.workerKind
    routerClassification = resolved.classification
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Routing failed'
    logger.error({ error: errorMessage }, '[ToolOrchestrator] Worker resolution failed')
    yield { type: 'error', message: errorMessage }
    yield { type: 'done' }
    return
  }

  yield { type: 'status', message: workerKindStatusLabel(workerKind) }

  const systemPrompt = buildWorkerSystemPrompt(workerKind, userInstructionsBlock, routerClassification)

  const context: OrchestratorToolContext = {
    userInput,
    priorHistory,
    userInstructionsBlock,
    documentsCache: new Map(),
  }

  const allowedToolNames = getToolsForWorker(workerKind)
  const validAgentNames = new Set(allowedToolNames)

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
    ...conversationHistoryToMessages(priorHistory),
    { role: 'user', content: userInput },
  ]

  const collectedDocumentIds: string[] = []
  let assistantResponse = ''

  for (let step = 0; step < ORCHESTRATOR_MAX_STEPS; step += 1) {
    yield {
      type: 'status',
      message: step === 0 ? 'Thinking…' : `Working (step ${step + 1})…`,
    }

    let rawResponse: string
    try {
      rawResponse = await collectChatResponse({
        model,
        messages,
        stream: false,
        think: false,
      })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Ollama request failed'
      logger.error({ error: errorMessage, step }, '[ToolOrchestrator] Chat request failed')
      yield { type: 'error', message: errorMessage }
      yield { type: 'done' }
      return
    }

    const parsed = parseOrchestratorAction(rawResponse)

    if (!parsed) {
      logger.warn(
        { step, rawPreview: rawResponse.slice(0, 300), messageCount: messages.length },
        '[ToolOrchestrator] Failed to parse orchestrator action',
      )
      messages.push({
        role: 'user',
        content: jsonRetryUserMessage(workerKind, validAgentNames),
      })
      continue
    }

    if (parsed.action === 'reply') {
      assistantResponse = parsed.content.trim()
      if (assistantResponse) {
        yield { type: 'chunk', content: assistantResponse }
      } else {
        const fallback =
          'I had trouble generating a response. Please try again or rephrase your request.'
        yield { type: 'chunk', content: fallback }
      }
      yield { type: 'done' }
      return
    }

    if (!validAgentNames.has(parsed.agent)) {
      logger.warn(
        { agent: parsed.agent, validAgents: [...validAgentNames], workerKind },
        '[ToolOrchestrator] Unknown or disallowed agent for worker',
      )
      messages.push({
        role: 'assistant',
        content: JSON.stringify({ action: 'call', agent: parsed.agent, params: parsed.params }),
      })
      messages.push({
        role: 'user',
        content: `Unknown or disallowed agent "${parsed.agent}". ${formatValidAgentsHint(workerKind, validAgentNames)}`,
      })
      continue
    }

    yield { type: 'status', message: toolStatusMessage(parsed.agent) }

    logger.debug(
      { agent: parsed.agent, params: JSON.stringify(parsed.params ?? {}).slice(0, 200), step },
      '[ToolOrchestrator] Executing agent',
    )

    const result = await executeOrchestratorTool(
      parsed.agent,
      parsed.params ?? {},
      context,
    )

    for (const event of result.events) {
      if (event.type === 'retrieved') {
        collectedDocumentIds.push(...event.documentIds)
      }
      if (event.type === 'stored') {
        collectedDocumentIds.push(event.documentId)
      }
      if (event.type !== 'chunk') {
        yield event
      }
    }

    messages.push({
      role: 'assistant',
      content: JSON.stringify({ action: 'call', agent: parsed.agent, params: parsed.params ?? {} }),
    })
    messages.push({
      role: 'user',
      content: formatToolResultForNextMessage(parsed.agent, result.output),
    })
  }

  logger.warn('[ToolOrchestrator] Exhausted max steps without final response')
  assistantResponse =
    "I'm having trouble processing your request. Could you try rephrasing it?"
  yield { type: 'chunk', content: assistantResponse }
  yield { type: 'done' }
}

function toolStatusMessage(agentName: string): string {
  switch (agentName) {
    case 'search_library':
      return 'Searching your library…'
    case 'search_for_question':
      return 'Searching for your question…'
    case 'search_for_command':
      return 'Searching for command targets…'
    case 'get_document':
      return 'Reading a document…'
    case 'save_documents':
      return 'Saving to your library…'
    case 'modify_documents':
      return 'Applying changes…'
    case 'compose_reply':
      return 'Composing response…'
    default:
      return `Running ${agentName}…`
  }
}
