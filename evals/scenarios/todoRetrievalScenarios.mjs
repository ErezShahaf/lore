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
