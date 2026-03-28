export const conversationRobustnessScenarios = [
  {
    id: 'greeting-then-add-todo',
    topic: 'conversation-robustness',
    title: 'Greeting before task creation',
    suites: ['smoke', 'full'],
    steps: [
      {
        userInput: 'Hey, how are you today?',
        expect: {
          todoCount: 0,
        },
      },
      {
        userInput: 'Nice. Add to my todo list: stretch for ten minutes',
        expect: {
          storedCount: 1,
          todoCount: 1,
          todoContentsIncludeSubstrings: ['stretch for ten minutes'],
        },
      },
    ],
  },
  {
    id: 'smalltalk-random-question-then-add',
    topic: 'conversation-robustness',
    title: 'Random smalltalk before action',
    suites: ['full'],
    steps: [
      {
        userInput: 'Hello! Quick question, what is your favorite color?',
        expect: {
          todoCount: 0,
        },
      },
      {
        userInput: 'Anyway, add to my todo list: buy new headphones',
        expect: {
          storedCount: 1,
          todoCount: 1,
          todoContentsIncludeSubstrings: ['buy new headphones'],
        },
      },
    ],
  },
  {
    id: 'pure-greeting-does-not-store',
    topic: 'conversation-robustness',
    title: 'Greeting alone does not create data',
    suites: ['full'],
    steps: [
      {
        userInput: 'Hi there!',
        expect: {
          todoCount: 0,
        },
      },
    ],
  },
  {
    id: 'identical-thought-twice-surfaces-duplicate-handling',
    topic: 'conversation-robustness',
    title: 'Saving the same long note twice should not silently duplicate',
    suites: ['full'],
    steps: [
      {
        userInput:
          'Save this thought: LORE_EVAL_DEDUP_MARKER The quick brown fox lists seven identical primes for the nightly audit.',
        expect: {
          storedCount: 1,
          responseJudge: 'The assistant should confirm the thought was saved.',
        },
      },
      {
        userInput:
          'Save this thought: LORE_EVAL_DEDUP_MARKER The quick brown fox lists seven identical primes for the nightly audit.',
        expect: {
          responseJudge:
            'The assistant should treat this as overlapping the prior save: ask add-new vs update, or otherwise explain duplicate handling. It must not cheerfully confirm a second unrelated save as if the two notes were completely independent.',
        },
      },
    ],
  },
  {
    id: 'duplicate-prompt-then-add-new-keeps-two-rows',
    topic: 'conversation-robustness',
    title: 'User can add a second copy after duplicate clarification',
    suites: ['full'],
    steps: [
      {
        userInput:
          'Save this: LORE_EVAL_ADDNEW_MARKER otters prefer turquoise umbrellas on Tuesdays.',
        expect: {
          storedCount: 1,
        },
      },
      {
        userInput:
          'Save this: LORE_EVAL_ADDNEW_MARKER otters prefer turquoise umbrellas on Tuesdays.',
        expect: {
          storedCount: 1,
          responseJudge:
            'The assistant should surface duplicate handling (show the existing note and ask add new vs update, or equivalent). It must not claim a brand-new independent save with no mention of similarity.',
        },
      },
      {
        userInput: 'add new',
        expect: {
          storedCount: 2,
          dataJudge:
            'The library must contain two stored documents whose text includes LORE_EVAL_ADDNEW_MARKER.',
          responseJudge:
            'The assistant should confirm keeping a second copy (or that both notes exist)—not refuse or claim nothing was stored if a second row was requested.',
        },
      },
    ],
  },
]
