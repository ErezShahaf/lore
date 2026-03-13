import { chat } from './ollamaService'
import { getSettings } from './settingsService'
import type { ClassificationResult } from '../../shared/types'

const CLASSIFICATION_PROMPT = `You are a classifier for a personal knowledge management system called Lore. Analyze the user's input and classify it.

Return JSON with this exact structure:
{
  "intent": "thought" | "question" | "command" | "instruction",
  "subtype": "<specific subtype>",
  "extractedDate": "<ISO date string, or null>",
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
- Always resolve relative dates to absolute ISO date strings (YYYY-MM-DD).
- "today" / "just now" / "earlier" → {currentDate}
- "yesterday" → {yesterdayDate}
- "last [day]" → compute the most recent past occurrence of that weekday
- "this morning" / "this afternoon" / "this evening" → {currentDate}
- "last week" → {lastWeekStart} (start of previous week, Monday)
- "this week" → {thisWeekStart}
- For recurring events (e.g. "every Monday", "weekly standup"), set extractedDate to the next occurrence and include "recurring" in extractedTags.
- If no date is mentioned at all, set extractedDate to null (the system will default to today).

Current date: {currentDate} ({currentDay})
Yesterday: {yesterdayDate}
Start of this week (Monday): {thisWeekStart}
Start of last week (Monday): {lastWeekStart}

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
  const now = new Date()
  const systemPrompt = buildSystemPrompt(now)

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

function toISODate(d: Date): string {
  return d.toISOString().split('T')[0]
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function getMondayOfWeek(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? 6 : day - 1
  d.setDate(d.getDate() - diff)
  return d
}

function buildSystemPrompt(now: Date): string {
  const currentDate = toISODate(now)
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)

  const thisMonday = getMondayOfWeek(now)
  const lastMonday = new Date(thisMonday)
  lastMonday.setDate(lastMonday.getDate() - 7)

  return CLASSIFICATION_PROMPT
    .replace(/\{currentDate\}/g, currentDate)
    .replace('{currentDay}', DAY_NAMES[now.getDay()])
    .replace('{yesterdayDate}', toISODate(yesterday))
    .replace('{thisWeekStart}', toISODate(thisMonday))
    .replace('{lastWeekStart}', toISODate(lastMonday))
}
