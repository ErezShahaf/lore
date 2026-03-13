import { chat } from './ollamaService'
import { getSettings } from './settingsService'
import type { ClassificationResult } from '../../shared/types'

const CLASSIFICATION_PROMPT = `You are a classifier for a personal knowledge management system called Lore. Analyze the user's input and classify it.

Return JSON with this exact structure:
{
  "intent": "thought" | "question" | "command" | "instruction",
  "subtype": "<specific subtype>",
  "extractedDate": "<ISO date if a date is mentioned or implied, null otherwise>",
  "extractedTags": ["<relevant tags>"],
  "confidence": <0.0 to 1.0>,
  "reasoning": "<brief explanation of classification>"
}

Intent definitions:
- "thought": The user is sharing information they want to remember (notes, ideas, observations, meeting summaries, todos).
- "question": The user is asking for information from their stored knowledge (recall, search, summaries, lists).
- "command": The user wants to modify existing data (delete, update, mark complete, reorder).
- "instruction": The user is setting a preference or rule for how Lore should behave.

Subtypes:
- thought: "general", "meeting", "idea", "learning", "todo"
- question: "recall", "search", "summary", "list"
- command: "delete", "update", "complete", "reorder"
- instruction: "preference", "rule", "alias"

Date extraction rules:
- "today" → current date
- "yesterday" → current date - 1
- "last Monday" → computed date
- No date mentioned → null

Current date: {currentDate}

IMPORTANT: Return ONLY valid JSON, no other text.`

const FALLBACK: ClassificationResult = {
  intent: 'thought',
  subtype: 'general',
  extractedDate: null,
  extractedTags: [],
  confidence: 0.5,
  reasoning: 'Fallback classification — could not parse LLM response',
}

export async function classifyInput(userInput: string): Promise<ClassificationResult> {
  const settings = getSettings()
  const currentDate = new Date().toISOString().split('T')[0]
  const systemPrompt = CLASSIFICATION_PROMPT.replace('{currentDate}', currentDate)

  try {
    const stream = chat({
      model: settings.selectedModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userInput },
      ],
      stream: false,
      format: 'json',
    })

    let response = ''
    for await (const chunk of stream) {
      response += chunk
    }

    const parsed = JSON.parse(response)

    return {
      intent: validateIntent(parsed.intent),
      subtype: typeof parsed.subtype === 'string' ? parsed.subtype : 'general',
      extractedDate: typeof parsed.extractedDate === 'string' ? parsed.extractedDate : null,
      extractedTags: Array.isArray(parsed.extractedTags)
        ? parsed.extractedTags.filter((t: unknown) => typeof t === 'string')
        : [],
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
    }
  } catch (err) {
    console.error('[Classifier] Failed to classify input:', err)
    return { ...FALLBACK }
  }
}

function validateIntent(value: unknown): ClassificationResult['intent'] {
  const valid = ['thought', 'question', 'command', 'instruction']
  return valid.includes(value as string)
    ? (value as ClassificationResult['intent'])
    : 'thought'
}
