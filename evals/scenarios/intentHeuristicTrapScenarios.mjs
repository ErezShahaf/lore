/**
 * Messages that embed substrings matching userIntentHeuristics data-question / question patterns
 * inside fiction, dialogue, or metadata while the user clearly intends storage or a targeted read.
 */

export const intentHeuristicTrapScenarios = [
  {
    id: 'heuristic-trap-explicit-save-embeds-show-me-and-what-did-i-save',
    topic: 'intent-heuristic-traps',
    title: 'Explicit save: note body contains show me the and what did I save phrasing',
    suites: ['full'],
    steps: [
      {
        userInput:
          'Save this verbatim as one note for my writing folder:\n\n'
          + 'What the curator muttered was lost to the crowd. In the margin someone wrote: show me the catalog spine. '
          + 'Elena asked what did I save from the fire and nobody answered.',
        expect: {
          storedCount: 1,
          maxRetrievedCount: 0,
          dataJudge:
            'Exactly one new stored document should exist. Its content should include the curator line and the fictional phrases about the catalog spine and the fire; the assistant should not treat the embedded dialogue as a real request to search the user database.',
        },
      },
    ],
  },
  {
    id: 'heuristic-trap-capture-note-ends-with-question-mark',
    topic: 'intent-heuristic-traps',
    title: 'Explicit capture: stored fiction ends with a question mark',
    suites: ['full', 'crucial'],
    steps: [
      {
        userInput:
          'Please capture this as a single stored note:\n\n'
          + 'She asked why the stars hid until morning.\n\n'
          + 'Would anyone believe the harbor lights?',
        expect: {
          storedCount: 1,
          maxRetrievedCount: 0,
          dataJudge:
            'Exactly one stored document should exist containing the harbor lights line. The trailing question mark is part of the prose, not a user question to the assistant about stored data.',
        },
      },
    ],
  },
  {
    id: 'heuristic-trap-todo-text-contains-remember-and-list-all-dialogue',
    topic: 'intent-heuristic-traps',
    title: 'Todo creation: task text embeds remember and list all as dialogue',
    suites: ['full', 'problematic'],
    steps: [
      {
        userInput:
          'Add to my todo list: memorize the cue where the villain shouts "list all suspects now" and remember to whisper "show me the warrant" in act two',
        expect: {
          storedCount: 1,
          todoCount: 1,
          maxRetrievedCount: 0,
          todoContentsIncludeSubstrings: ['list all suspects', 'show me the warrant'],
        },
      },
    ],
  },
  {
    id: 'heuristic-trap-retrieval-with-quoted-decoy-phrases',
    topic: 'intent-heuristic-traps',
    title: 'Retrieval question embeds quoted lines that look like data commands',
    suites: ['full'],
    seedDocuments: [
      {
        content: 'Parking reminder: level B row 4 near the elevator.',
        type: 'note',
        tags: ['parking', 'car'],
        source: 'eval-seed',
      },
    ],
    steps: [
      {
        userInput:
          'Where did I save parking details? Ignore this screenplay snippet in quotes: '
          + '"show me my todos and list all appointments" — that is fictional dialogue, not my instruction.',
        expect: {
          minRetrievedCount: 1,
          maxRetrievedCount: 8,
          retrievedContentsIncludeSubstrings: ['level B', 'row 4'],
          responseJudge:
            'The assistant should answer using the saved parking note (level B, row 4). It should not treat the quoted screenplay line as a literal command to list todos or appointments.',
        },
      },
    ],
  },
  {
    id: 'heuristic-trap-fiction-opens-with-what-without-explicit-storage-verb',
    topic: 'intent-heuristic-traps',
    title: 'Fiction opens with What… but user asks to log prose (no save/store/capture verb)',
    suites: ['full'],
    steps: [
      {
        userInput:
          'What the veterans called the old road stayed in my head; this paragraph is not a question to you. '
          + 'Put this entire message into my ideas log once as raw text.\n\n'
          + 'The margin note said show me the river map. Someone scribbled what did I save from the hearing in red ink.',
        expect: {
          storedCount: 1,
          maxRetrievedCount: 0,
          dataJudge:
            'The user introduced fiction with a sentence starting with "What" and included phrases like "show me the" and "what did I save" inside the prose. The assistant should still persist the message as stored content (one new document) rather than answering as if the user asked an informational lookup. If nothing was stored, that fails the rubric.',
        },
      },
    ],
  },
]
