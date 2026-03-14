export const RESTRUCTURE_TODO_PROMPT = `Extract a clear, concise todo item from the user's input.
Return only the task description — no numbering, no prefixes, no extra commentary.

Raw input: {userInput}`

export function buildTodoCompletePrompt(userInput: string, docsForPrompt: string): string {
  return `The user wants to mark a todo as complete. Based on their input, identify which todo they're referring to.

User input: ${userInput}

Active todos:
${docsForPrompt}

Return JSON: { "targetId": "<id of the matching todo>", "confidence": 0.0-1.0 }
Return ONLY valid JSON.`
}

