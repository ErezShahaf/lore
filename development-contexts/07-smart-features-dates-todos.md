# Phase 7 — Smart Features: Dates, Todos & Context

## Goal

Implement the intelligent features that make Lore genuinely useful: date-aware recall, smart todo/task management, multi-document context assembly, and preference-aware responses. This phase polishes the AI pipeline from Phase 6 into a powerful personal knowledge system.

## Prerequisites

- Phase 1–6 complete (working agent pipeline with classification, storage, and retrieval)

## Steps

### 7.1 Date-aware storage and retrieval

**Enhanced date extraction in the classifier:**

The classifier already extracts dates, but now we make it more sophisticated:

- **Relative dates**: "today", "yesterday", "last week", "this morning", "on Monday"
- **Absolute dates**: "March 13th", "2026-03-13"
- **Implied dates**: "just now", "earlier" → current date
- **Recurring references**: "every Monday", "weekly standup" → store as metadata
- **No date**: Default to the current date at time of storage

Update the classification prompt to include:
```
Date extraction rules:
- Always resolve relative dates to absolute ISO dates.
- "today" / "just now" / "earlier" → {currentDate}
- "yesterday" → {yesterdayDate}
- "last [day]" → compute the most recent past occurrence
- "this morning/afternoon/evening" → {currentDate}
- If no date is mentioned, use {currentDate} as the default.
- For recurring events, set the date to the next occurrence and add "recurring" to tags.
```

**Date-filtered retrieval:**

Enhance `retrieveRelevantDocuments()`:
- When the query mentions "today", "yesterday", "last week", etc., apply a date range filter in addition to vector similarity
- Combine vector search with metadata filtering: `WHERE date >= '2026-03-13' AND date <= '2026-03-13' AND isDeleted = false`
- LanceDB supports SQL-like filter expressions on non-vector columns

### 7.2 Smart todo management

Todo items need special treatment because they are queried, listed, reordered, and completed — unlike passive thoughts.

**Todo-specific operations:**

`electron/services/handlers/todoHandler.ts`:

- **Add todo**: Store with `type: 'todo'`, extract priority if mentioned, store the order/position
- **List todos**: Retrieve all non-deleted todos, apply any instruction-based ordering, format as a numbered list
- **Complete todo**: Mark as done by updating metadata (`{ completed: true, completedAt: "..." }`)
- **Reorder todos**: When the user says "put A above B", store this as an instruction document. When listing todos, retrieve matching instructions and apply them to the sort order.
- **Remove todo**: Soft-delete the todo document

**Todo metadata schema (in the `metadata` JSON field):**
```typescript
interface TodoMetadata {
  completed: boolean;
  completedAt: string | null;
  priority: 'high' | 'medium' | 'low' | null;
  position: number;           // Manual ordering
  category: string | null;    // "work", "personal", etc.
}
```

**Listing with instructions:**

When the user asks "show my todo list":
1. Retrieve all todo documents (`type: 'todo'`, `isDeleted: false`, `metadata.completed: false`)
2. Retrieve instruction documents related to todo ordering
3. Apply instruction-based sorting (e.g., "work tasks first")
4. Apply priority-based secondary sorting
5. Format and return

### 7.3 Multi-document retrieval strategy

The current retrieval returns the top-N results. Enhance it to be smarter about how many documents to return:

**Adaptive retrieval:**

```typescript
async function retrieveWithAdaptiveThreshold(
  query: string,
  options: RetrievalOptions
): Promise<RetrievedDocumentSet> {
  // 1. Start with a generous limit (e.g., 30 results)
  // 2. Score each result
  // 3. Find the "relevance cliff" — where scores drop significantly
  // 4. Return all documents above the cliff
  
  const results = await lanceService.searchSimilar(queryVector, 30, filter);
  
  const relevantResults = applyRelevanceCliff(results);
  
  return {
    documents: relevantResults,
    totalCandidates: results.length,
    cutoffScore: relevantResults[relevantResults.length - 1]?.score ?? 0,
  };
}

function applyRelevanceCliff(results: ScoredDocument[]): ScoredDocument[] {
  // If the gap between consecutive scores exceeds a threshold,
  // that's the "cliff" — stop including documents after that point.
  // Minimum: always return at least 1 result (if any exist)
  // Maximum: cap at 10 to avoid overwhelming the LLM context
}
```

**Why this matters:**
- "What are all my todos?" → should return ALL todos (many documents)
- "What did Alice say about the API?" → might be 1-2 specific documents
- "Tell me everything about Project Alpha" → could be many scattered notes

The adaptive threshold ensures the right amount of context without manual tuning.

### 7.4 Instruction-aware responses

Instructions are stored as documents with `type: 'instruction'`. They modify how the agent behaves.

**Instruction retrieval and application:**

When handling any question or list request:
1. Retrieve the main documents matching the query
2. Also search for instruction documents matching the query's topic
3. Include matching instructions in the RAG prompt as "user preferences"

**Example flow:**
- User stores: "When showing my todo list, put work tasks above personal tasks"
  → Stored as `{ type: 'instruction', content: '...', tags: ['todo', 'ordering', 'preference'] }`
- User later asks: "Show my todo list"
  → Agent retrieves todos AND the ordering instruction
  → RAG prompt includes the instruction → response shows work tasks first

**Instruction conflict resolution:**
- If multiple instructions contradict each other, use the most recent one
- Include both in the RAG prompt and let the LLM resolve with recency preference

### 7.5 Contextual understanding

Enhance the agent to understand contextual references:

- **Pronouns**: "What was that meeting about?" → the agent should know "that meeting" refers to the most recently discussed meeting
- **Implicit references**: "Add that to my todo list" → "that" refers to the last discussed topic
- **Session context**: Within a popup session, maintain a sliding window of conversation history to resolve references

**Implementation:**
- Store the last 5 messages and their associated documents in an in-memory session context
- Pass this context to the classifier and handlers so they can resolve references
- Clear the session context when the popup is hidden

### 7.6 Smart grouping for responses

When the agent returns multiple documents, group them intelligently:

- **By date**: If asking about "this week's notes", group by day
- **By type**: If asking about "everything about Project Alpha", group meetings, todos, and thoughts separately
- **By topic**: Use the tags to cluster related documents

Format the response with clear headers and structure:

```
Here are your notes from this week:

**Monday, March 9:**
- Meeting with Alice about API redesign
- Idea: cache responses using Redis

**Tuesday, March 10:**
- Todo: Review Alice's PR for the API changes
- Standup notes: discussed timeline for v2 launch

**Wednesday, March 11:**
- Learning: LanceDB supports hybrid search
```

### 7.7 Duplicate detection

Before storing a new thought, check if a very similar document already exists:

```typescript
async function checkForDuplicate(content: string): Promise<LoreDocument | null> {
  const embedding = await embeddingService.embedText(content);
  const results = await lanceService.searchSimilar(embedding, 1);
  
  if (results.length > 0 && results[0].score > DUPLICATE_THRESHOLD) {
    return results[0];
  }
  return null;
}
```

If a near-duplicate is found:
- Ask the user: "This seems similar to a note you already have: [preview]. Should I update it or save as a new note?"
- Or automatically merge/update if the confidence is very high

## Verification

1. "I had a meeting today about the roadmap" → stored with today's date
2. "What were my notes from today?" → retrieves today's notes, filtered by date
3. "Add 'review PR' to my todo list" → stored as a todo
4. "Show my todo list" → lists all active todos
5. "Put work tasks above personal tasks" → stored as instruction
6. "Show my todo list" (again) → now work tasks appear first
7. "Mark 'review PR' as done" → todo is completed
8. "Tell me everything about Project Alpha" → retrieves all related docs, grouped by type
9. "What was that about?" (follow-up) → uses session context to resolve "that"
10. Storing a near-duplicate → user is warned or it's merged

## Files Created / Modified

```
electron/services/handlers/todoHandler.ts          (new, or enhance existing commandHandler)
electron/services/handlers/questionHandler.ts      (updated — date filtering, instruction awareness)
electron/services/handlers/thoughtHandler.ts       (updated — duplicate detection)
electron/services/documentPipeline.ts              (updated — adaptive retrieval)
electron/services/classifierService.ts             (updated — better date extraction)
electron/services/agentService.ts                  (updated — session context, instruction retrieval)
shared/types.ts                                    (updated — TodoMetadata, RetrievedDocumentSet)
```
