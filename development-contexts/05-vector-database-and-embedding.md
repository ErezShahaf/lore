# Phase 5 — Vector Database & Embedding (LanceDB)

## Goal

Set up LanceDB as the local embedded vector database and build the embedding pipeline. By the end of this phase, the app can store documents with vector embeddings and retrieve them via semantic similarity search.

## Prerequisites

- Phase 1–4 complete (working app with Ollama integration)

## Why LanceDB

- **Embedded**: runs in-process, no separate server needed
- **Performant**: built on Apache Arrow, optimized for vector search
- **Persistent**: data stored as files on disk in the user's data directory
- **Simple API**: JavaScript/TypeScript SDK available via `@lancedb/lancedb`

## Document Schema

Every piece of information stored in Lore is a "document" with the following schema:

```typescript
interface LoreDocument {
  id: string;                          // UUID
  content: string;                     // The actual text content
  vector: Float32Array;                // Embedding vector
  type: 'thought' | 'todo' | 'instruction' | 'meeting' | 'note';
  createdAt: string;                   // ISO 8601 timestamp
  updatedAt: string;                   // ISO 8601 timestamp
  date: string;                        // Human-readable date reference (e.g., "2026-03-13")
  tags: string;                        // Comma-separated tags extracted by the AI
  source: string;                      // Original raw input from the user
  metadata: string;                    // JSON string for extensible metadata
  isDeleted: boolean;                  // Soft delete flag
}
```

### Why these fields

- **type**: Allows filtering queries (e.g., "show todos" only searches type=todo)
- **date**: Extracted by the AI from context ("today's meeting" → "2026-03-13"). Enables temporal queries.
- **tags**: AI-extracted keywords for additional filtering
- **source**: The original user input before restructuring, preserved for reference
- **metadata**: Flexible JSON for future extensions (priority, linked documents, etc.)
- **isDeleted**: Soft deletes so the user can undo; actual cleanup happens periodically

## Steps

### 5.1 LanceDB setup

`electron/services/lanceService.ts`:

**Initialization:**
- `initialize(): Promise<void>` — opens (or creates) the LanceDB database in the user's app data directory (`app.getPath('userData')/lore-db/`)
- Creates the `documents` table if it doesn't exist, with the schema above
- Call this during app startup in `main.ts`

**Write operations:**
- `insertDocument(document: LoreDocument): Promise<void>` — inserts a single document
- `insertDocuments(documents: LoreDocument[]): Promise<void>` — batch insert
- `updateDocument(id: string, updates: Partial<LoreDocument>): Promise<void>` — update fields (re-embed if content changed)
- `softDeleteDocument(id: string): Promise<void>` — sets `isDeleted: true`
- `hardDeleteDocuments(): Promise<void>` — permanently removes all soft-deleted documents

**Read operations:**
- `searchSimilar(queryVector: Float32Array, limit: number, filter?: string): Promise<LoreDocument[]>` — vector similarity search with optional filter expression
- `getDocumentById(id: string): Promise<LoreDocument | null>` — exact lookup
- `getDocumentsByType(type: string): Promise<LoreDocument[]>` — filtered by type
- `getDocumentsByDateRange(startDate: string, endDate: string): Promise<LoreDocument[]>` — filtered by date range
- `getAllDocuments(includeDeleted?: boolean): Promise<LoreDocument[]>` — for debugging/export

### 5.2 Embedding service

`electron/services/embeddingService.ts`:

Uses Ollama's embedding endpoint to convert text to vectors.

- `embedText(text: string): Promise<Float32Array>` — calls `POST /api/embed` with the configured embedding model
- `embedTexts(texts: string[]): Promise<Float32Array[]>` — batch embedding for efficiency
- `getEmbeddingDimension(): number` — returns the vector dimension for the current model (e.g., 768 for nomic-embed-text)

The embedding model is configured in settings (default: `nomic-embed-text`).

Error handling:
- If the embedding model is not pulled, prompt the user to download it
- If Ollama is not running, queue the embedding and retry when connection is restored

### 5.3 Document storage pipeline

Build a pipeline that takes raw content and stores it properly:

`electron/services/documentPipeline.ts`:

```typescript
async function storeThought(input: StoreThoughtInput): Promise<LoreDocument> {
  // 1. Generate embedding for the restructured content
  // 2. Create the document object with all metadata
  // 3. Insert into LanceDB
  // 4. Return the created document
}

interface StoreThoughtInput {
  content: string;           // Restructured content from the AI
  originalInput: string;     // Raw user input
  type: DocumentType;        // Classified type
  date: string;              // Extracted date
  tags: string[];            // Extracted tags
}
```

### 5.4 Retrieval pipeline

Build a retrieval function that implements the "multi-document retrieval until irrelevant" strategy:

```typescript
async function retrieveRelevantDocuments(
  query: string,
  options?: RetrievalOptions
): Promise<LoreDocument[]> {
  // 1. Embed the query
  // 2. Search LanceDB with a generous limit (e.g., 20)
  // 3. Filter out soft-deleted documents
  // 4. Apply type/date filters if provided
  // 5. Apply relevance threshold — keep documents above a similarity score cutoff
  // 6. Return the filtered results
}

interface RetrievalOptions {
  type?: DocumentType;
  dateFrom?: string;
  dateTo?: string;
  maxResults?: number;
  similarityThreshold?: number;   // Default: 0.5 (tunable)
}
```

The key insight: don't just return top-1. Return all results above the similarity threshold, so that queries like "what are my todos" get all relevant todo documents, not just the most similar one.

### 5.5 Database maintenance

- **Compaction**: LanceDB may need periodic compaction. Run this on app startup or on a schedule.
- **Cleanup**: Periodically hard-delete documents that have been soft-deleted for more than 30 days.
- **Stats**: Provide a function to get database stats (total documents, size on disk) for the settings/about page.

### 5.6 IPC exposure

Add IPC handlers for renderer access (primarily for debugging/settings, since most DB operations happen in the agent pipeline):

| Channel                | Direction        | Payload                         | Purpose                      |
| ---------------------- | ---------------- | ------------------------------- | ---------------------------- |
| `db:stats`             | Renderer → Main  | none                            | Get database statistics      |
| `db:search`            | Renderer → Main  | `{ query: string, options? }`   | Search documents (debugging) |
| `db:get-by-type`       | Renderer → Main  | `{ type: string }`              | Get documents by type        |

### 5.7 Testing the pipeline

Create test utilities:
- A function to insert sample documents (thoughts, todos, meeting notes) with realistic content and dates
- A function to run test queries and log similarity scores
- These help verify the embedding and retrieval quality before wiring up the full agent pipeline

## Data Directory Structure

```
{userData}/
└── lore-db/
    └── documents.lance/     # LanceDB table files
        ├── data/
        │   ├── *.lance       # Arrow-format data files
        │   └── ...
        └── _versions/
            └── *.manifest    # Version manifests
```

## Verification

1. App starts → LanceDB initializes without errors
2. Insert a test document via a dev-only IPC call → document is stored
3. Search with a related query → the test document is retrieved with a high similarity score
4. Search with an unrelated query → no results (or very low scores below threshold)
5. Soft-delete a document → it no longer appears in search results
6. Check database stats → shows correct document count and size

## Files Created / Modified

```
electron/services/lanceService.ts         (new)
electron/services/embeddingService.ts     (new)
electron/services/documentPipeline.ts     (new)
electron/ipc/handlers.ts                  (updated — DB IPC handlers)
electron/preload.ts                       (updated — DB IPC methods)
electron/main.ts                          (updated — initialize LanceDB on startup)
shared/types.ts                           (updated — LoreDocument, DocumentType, etc.)
```

## Dependencies to Install

```
@lancedb/lancedb
apache-arrow
uuid (for generating document IDs)
```
