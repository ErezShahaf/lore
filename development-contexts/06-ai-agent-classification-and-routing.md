# Phase 6 — AI Agent: Classification & Routing

## Goal

Build the core intelligence pipeline. Every user input is classified by the LLM into a category, then routed to the appropriate handler: store a thought, answer a question, execute a command (delete, update), or store a preference/instruction. This is the brain of Lore.

## Prerequisites

- Phase 1–5 complete (working app with Ollama and LanceDB)

## Architecture

```
User Input
    │
    ▼
┌─────────────────┐
│   Classifier     │  ← LLM with JSON output
│   (intent +      │
│    metadata)     │
└────────┬────────┘
         │
    ┌────┼────┬──────────┬──────────┐
    ▼    ▼    ▼          ▼          ▼
 Thought  Question  Command    Instruction
 Handler  Handler   Handler    Handler
    │       │         │           │
    ▼       ▼         ▼           ▼
  Store   RAG +     Mutate     Store as
  in DB   Respond   DB         instruction
```

## Steps

### 6.1 Input classifier

`electron/services/classifierService.ts`:

The classifier asks the LLM to analyze the user's input and return structured JSON:

```typescript
interface ClassificationResult {
  intent: 'thought' | 'question' | 'command' | 'instruction';
  subtype: string;
  extractedDate: string | null;
  extractedTags: string[];
  confidence: number;
  reasoning: string;
}
```

**Intent definitions:**

- **thought**: The user is sharing information they want to remember. Examples:
  - "Just had a meeting with the design team about the new dashboard"
  - "Idea: we should cache API responses to reduce latency"
  - "Today I learned that LanceDB supports full-text search"

- **question**: The user is asking for information from their stored knowledge. Examples:
  - "What were my notes from today's meeting?"
  - "Show me my todo list"
  - "What did I say about caching?"

- **command**: The user wants to modify existing data. Examples:
  - "Delete the todo about buying groceries"
  - "Mark task X as done"
  - "Update my meeting notes to include the decision about the API"

- **instruction**: The user is setting a preference or rule for how Lore should behave. Examples:
  - "When showing my todo list, put work tasks above personal tasks"
  - "Always tag meeting notes with the attendees' names"
  - "Remember that Project Alpha is the codename for the dashboard redesign"

**Classification prompt:**

```
You are a classifier for a personal knowledge management system. Analyze the user's input and classify it.

Return JSON with this exact structure:
{
  "intent": "thought" | "question" | "command" | "instruction",
  "subtype": "<specific subtype>",
  "extractedDate": "<ISO date if a date is mentioned or implied, null otherwise>",
  "extractedTags": ["<relevant tags>"],
  "confidence": <0.0 to 1.0>,
  "reasoning": "<brief explanation of classification>"
}

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
```

Use Ollama's JSON mode (`format: "json"`) for reliable structured output.

### 6.2 Thought handler

`electron/services/handlers/thoughtHandler.ts`:

When input is classified as a thought:

1. **Restructure**: Ask the LLM to clean up and restructure the thought into a well-organized note. The prompt:
   ```
   Restructure the following raw thought into a clear, well-organized note.
   Preserve all information but improve clarity and structure.
   If it contains action items, format them as a bullet list.
   If it mentions specific dates, people, or projects, highlight them.
   Keep it concise.
   
   Raw input: {userInput}
   ```

2. **Extract metadata**: Use the classification result for date, tags, and type (subtype becomes the document type — e.g., "todo" subtype → document type "todo")

3. **Store**: Call `documentPipeline.storeThought()` with the restructured content and metadata

4. **Respond**: Send a brief confirmation back to the user:
   - "Got it! I've saved your note about [topic]."
   - Or show a preview of the restructured note

### 6.3 Question handler (RAG)

`electron/services/handlers/questionHandler.ts`:

When input is classified as a question:

1. **Retrieve**: Call `retrieveRelevantDocuments()` with the query text and any filters implied by the classification (date, type)

2. **Check for instructions**: Also retrieve any matching instruction-type documents that might affect how the response should be formatted

3. **Build RAG prompt**:
   ```
   Answer the user's question using ONLY the following context from their stored notes.
   If the context doesn't contain enough information to answer, say so honestly.
   
   Context:
   ---
   {retrieved documents, formatted with dates and types}
   ---
   
   User instructions (if any):
   ---
   {matching instruction documents}
   ---
   
   Question: {userInput}
   ```

4. **Generate and stream**: Send the RAG prompt to Ollama and stream the response back to the chat UI

5. **Handle empty results**: If no relevant documents are found, respond with something like "I don't have any notes about that yet. Would you like to tell me about it?"

### 6.4 Command handler

`electron/services/handlers/commandHandler.ts`:

When input is classified as a command:

1. **Identify target**: Use the LLM to identify which document(s) the command refers to:
   ```
   The user wants to {command.subtype} something. Based on their input and the following matching documents, identify which document(s) they're referring to.
   
   User input: {userInput}
   
   Matching documents:
   {retrieved documents with IDs}
   
   Return JSON:
   {
     "targetDocumentIds": ["id1", "id2"],
     "action": "delete" | "update" | "complete",
     "updatedContent": "<new content if action is update, null otherwise>",
     "confidence": 0.0-1.0
   }
   ```

2. **Execute**: Based on the action:
   - **delete**: Soft-delete the target documents
   - **update**: Update the content (re-embed) of the target documents
   - **complete**: Mark todo items as done (update metadata)
   - **reorder**: Store a new instruction document about ordering preferences

3. **Confirm**: Respond with what was done: "Done! I've removed 'buy groceries' from your todo list."

4. **Safety**: For destructive actions (delete), consider asking for confirmation before proceeding. Include the document content in the confirmation so the user can verify.

### 6.5 Instruction handler

`electron/services/handlers/instructionHandler.ts`:

When input is classified as an instruction:

1. **Store as instruction document**: Create a document with `type: 'instruction'` containing the user's preference
2. **Acknowledge**: "Got it! I'll remember that from now on."
3. **Check for conflicting instructions**: Search for existing instructions on the same topic. If found, ask the user whether to replace or keep both.

### 6.6 Agent orchestrator

`electron/services/agentService.ts`:

The central orchestrator that ties everything together:

```typescript
async function processUserInput(userInput: string): AsyncGenerator<AgentEvent> {
  // 1. Classify the input
  const classification = await classifyInput(userInput);
  
  // 2. Route to the appropriate handler
  switch (classification.intent) {
    case 'thought':
      yield* handleThought(userInput, classification);
      break;
    case 'question':
      yield* handleQuestion(userInput, classification);
      break;
    case 'command':
      yield* handleCommand(userInput, classification);
      break;
    case 'instruction':
      yield* handleInstruction(userInput, classification);
      break;
  }
}
```

The orchestrator uses `AsyncGenerator` to yield events that the IPC layer translates into renderer messages (status updates, streaming text, confirmations).

```typescript
type AgentEvent =
  | { type: 'status'; message: string }           // "Classifying your input..."
  | { type: 'chunk'; content: string }             // Streaming response text
  | { type: 'stored'; document: LoreDocument }     // Document was stored
  | { type: 'deleted'; documentId: string }        // Document was deleted
  | { type: 'error'; message: string }             // Something went wrong
  | { type: 'done' };                              // Processing complete
```

### 6.7 Update chat IPC to use the agent

Replace the direct Ollama chat call in the IPC handler with the agent orchestrator:

```typescript
ipcMain.handle('chat:send', async (event, { message }) => {
  const generator = agentService.processUserInput(message);
  
  for await (const agentEvent of generator) {
    switch (agentEvent.type) {
      case 'chunk':
        event.sender.send('chat:response-chunk', { chunk: agentEvent.content });
        break;
      case 'status':
        event.sender.send('chat:status', { message: agentEvent.message });
        break;
      case 'done':
        event.sender.send('chat:response-end');
        break;
      // ... handle other events
    }
  }
});
```

### 6.8 Conversation context

The agent should maintain minimal conversation context within a session (while the popup is open) to handle follow-ups:
- "What are my todos?" → [list of todos]
- "Remove the third one" → understands "third one" refers to the third todo from the previous response

Store the last few messages and the last retrieved documents in memory (cleared when the popup is hidden).

## Verification

1. Type "I had a meeting today with Alice about project roadmap" → classified as thought, restructured, stored, confirmation shown
2. Type "What did I discuss in today's meeting?" → classified as question, retrieves the meeting note, generates RAG answer
3. Type "Delete the meeting notes from today" → classified as command, identifies the document, soft-deletes it, confirms
4. Type "When showing todos, put work items first" → classified as instruction, stored, acknowledged
5. Type something ambiguous → classifier assigns the most likely intent with confidence score
6. Follow-up questions within the same session use conversation context

## Files Created / Modified

```
electron/services/classifierService.ts            (new)
electron/services/handlers/thoughtHandler.ts       (new)
electron/services/handlers/questionHandler.ts      (new)
electron/services/handlers/commandHandler.ts       (new)
electron/services/handlers/instructionHandler.ts   (new)
electron/services/agentService.ts                  (new)
electron/ipc/handlers.ts                           (updated — use agent orchestrator)
shared/types.ts                                    (updated — ClassificationResult, AgentEvent, etc.)
```
