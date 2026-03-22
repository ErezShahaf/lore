import { chat } from './ollamaService'

/**
 * Single place for streaming Lore’s question-answering model (grounded RAG and no-retrieval cases).
 */
export async function* streamQuestionLlmChunks(
  model: string,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
): AsyncGenerator<string> {
  const stream = chat({
    model,
    messages,
    stream: true,
    think: false,
  })

  for await (const chunk of stream) {
    yield chunk
  }
}

export function buildNoDocumentsQuestionUserMessage(input: {
  readonly situationSummary: string
  readonly userInput: string
}): string {
  return [
    'Retrieval returned no matching documents for this question.',
    '',
    'Situation summary:',
    input.situationSummary.trim() || '(none)',
    '',
    'User question:',
    input.userInput,
    '',
    'You must not invent facts or pretend notes exist. Briefly tell the user you could not find relevant information in their library. Use generic wording only—do not infer specific types from the user input.',
    '',
    'When the user\'s message is primarily pasted structured data or raw content (e.g. JSON, CSV, a block of text) with no clear question, and nothing was retrieved: reply in one or two short sentences. Say you don\'t have it; ask if they want to save it; and add: "If so, a short description (what it is or why you\'re keeping it) will make it easier to find later." Do not list other options. Do not infer details from the payload—use generic wording only.',
    '',
    'If User standing instructions in the system prompt specify exact wording, tone, or greetings for this situation, follow them. Otherwise reply in one or two short sentences.',
  ].join('\n')
}
