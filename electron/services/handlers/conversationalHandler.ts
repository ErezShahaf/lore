import { chat } from '../ollamaService'
import { getSettings } from '../settingsService'
import { loadSkill, loadAllSkills, formatSkillsForPrompt } from '../skillLoader'
import { logger } from '../../logger'
import type { ClassificationResult, ConversationEntry, AgentEvent } from '../../../shared/types'

let cachedConversationalSystemPrompt: string | null = null

function buildConversationalSystemPrompt(): string {
  if (cachedConversationalSystemPrompt) return cachedConversationalSystemPrompt

  const template = loadSkill('conversational')
  const allSkills = loadAllSkills()
  const skillsContent = formatSkillsForPrompt(allSkills, 'conversational')

  cachedConversationalSystemPrompt = template.replace('{skillsContent}', skillsContent)
  logger.debug({ skillCount: allSkills.length - 1 }, '[Conversational] Built system prompt with agent skills')
  return cachedConversationalSystemPrompt
}

export async function* handleConversational(
  userInput: string,
  _classification: ClassificationResult,
  conversationHistory: readonly ConversationEntry[] = [],
): AsyncGenerator<AgentEvent> {
  yield { type: 'status', message: 'Thinking...' }

  const settings = getSettings()
  const systemPrompt = buildConversationalSystemPrompt()

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
  ]

  for (const entry of conversationHistory) {
    messages.push({ role: entry.role, content: entry.content })
  }

  messages.push({ role: 'user', content: userInput })

  try {
    const stream = chat({
      model: settings.selectedModel,
      messages,
      stream: true,
      think: false,
    })

    for await (const chunk of stream) {
      yield { type: 'chunk', content: chunk }
    }
  } catch (err) {
    yield {
      type: 'error',
      message: err instanceof Error ? err.message : 'Failed to generate response',
    }
  }

  yield { type: 'done' }
}
