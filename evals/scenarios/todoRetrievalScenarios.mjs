export const todoRetrievalScenarios = [
  {
    id: 'retrieve-todos-after-creation',
    topic: 'todo-retrieval',
    title: 'Retrieve todos after creating them',
    suites: ['smoke', 'full'],
    steps: [
      {
        userInput: 'Todos: buy milk, call mom',
        expect: {
          storedCount: 2,
          todoCount: 2,
        },
      },
      {
        userInput: 'What are my todos?',
        expect: {
          todoCount: 2,
          responseIncludes: ['buy milk', 'call mom'],
        },
      },
    ],
  },
  {
    id: 'todo-list-each-item-on-own-line',
    topic: 'todo-retrieval',
    title: 'Listed todos appear one per line not concatenated',
    suites: ['full'],
    steps: [
      {
        userInput: 'Todos: swim 5 km, run 5 km, run 10 km',
        expect: {
          storedCount: 3,
          todoCount: 3,
        },
      },
      {
        userInput: 'What are my todos?',
        expect: {
          todoCount: 3,
          responseIncludes: ['swim 5 km', 'run 5 km', 'run 10 km'],
          responseJudge: 'When listing multiple todos, each todo must appear on its own line. The response must not concatenate all todos on a single line separated only by spaces or inline punctuation.',
        },
      },
    ],
  },
  {
    id: 'todo-list-no-today-default-when-not-asked',
    topic: 'todo-retrieval',
    title: 'Todo list does not use today framing when user did not ask for date',
    suites: ['full'],
    seedDocuments: [
      {
        content: 'swim 5 km',
        type: 'todo',
        date: '2026-03-01',
        tags: ['todo'],
        source: 'eval-seed',
      },
      {
        content: 'run 5 km',
        type: 'todo',
        date: '2026-03-10',
        tags: ['todo'],
        source: 'eval-seed',
      },
    ],
    steps: [
      {
        userInput: 'What are my todos?',
        expect: {
          todoCount: 2,
          responseIncludes: ['swim 5 km', 'run 5 km'],
          responseExcludes: ["today's", 'for today', 'Todays'],
          responseJudge: 'When the user did not ask for a time or date range, the response must not use "today\'s", "for today", or similar time-bounded wording. Present the list without implying a date filter.',
        },
      },
    ],
  },
  {
    id: 'retrieve-todos-with-casual-phrasing',
    topic: 'todo-retrieval',
    title: 'Retrieve todos with casual wording',
    suites: ['full'],
    steps: [
      {
        userInput: 'Todos: pick up laundry, send the invoice',
        expect: {
          storedCount: 2,
          todoCount: 2,
        },
      },
      {
        userInput: 'What do I still need to do?',
        expect: {
          todoCount: 2,
          responseIncludes: ['pick up laundry', 'send the invoice'],
        },
      },
    ],
  },
]
