export const todoCreationScenarios = [
  {
    id: 'add-single-todo-explicit',
    topic: 'todo-creation',
    title: 'Add a single explicit todo',
    suites: ['smoke', 'full'],
    steps: [
      {
        userInput: 'Add to my todo list: buy milk',
        expect: {
          responseIncludes: ['saved'],
          storedCount: 1,
          todoCount: 1,
          todoContentsIncludeSubstrings: ['buy milk'],
          dataJudge: 'The todo database should contain exactly one actionable todo representing buying milk. Minor normalization differences like prefixes are acceptable, but unrelated tasks are not.',
        },
      },
    ],
  },
  {
    id: 'add-single-todo-variant-phrasing',
    topic: 'todo-creation',
    title: 'Add a todo with alternate phrasing',
    suites: ['full'],
    steps: [
      {
        userInput: 'Please put "call mom" on my todo list.',
        expect: {
          responseIncludes: ['saved'],
          storedCount: 1,
          todoCount: 1,
          todoContentsIncludeSubstrings: ['call mom'],
        },
      },
    ],
  },
  {
    id: 'add-multiple-todos-inline-list',
    topic: 'todo-creation',
    title: 'Add multiple todos in one message',
    suites: ['smoke', 'full'],
    steps: [
      {
        userInput: 'Todos: buy milk, call mom, pay rent',
        expect: {
          responseIncludes: ['saved 3 todos'],
          storedCount: 3,
          todoCount: 3,
          todoContentsIncludeSubstrings: ['buy milk', 'call mom', 'pay rent'],
          dataJudge: 'The todo database should contain three distinct actionable tasks corresponding to buy milk, call mom, and pay rent.',
        },
      },
    ],
  },
  {
    id: 'add-multiple-todos-multiline',
    topic: 'todo-creation',
    title: 'Add todos from a multiline list',
    suites: ['full'],
    steps: [
      {
        userInput: 'Add to my todo list:\nbook dentist\nrenew passport\nbuy cat food',
        expect: {
          storedCount: 3,
          todoCount: 3,
          todoContentsIncludeSubstrings: ['book dentist', 'renew passport', 'buy cat food'],
        },
      },
    ],
  },
  {
    id: 'duplicate-todo-still-persists-separately',
    topic: 'todo-creation',
    title: 'Near-duplicate todo requests still store separately',
    suites: ['full'],
    steps: [
      {
        userInput: 'Add to my todo list: call the plumber',
        expect: {
          storedCount: 1,
          todoCount: 1,
        },
      },
      {
        userInput: 'Add to my todo list: call the plumber',
        expect: {
          storedCount: 1,
          todoCount: 2,
          todoContentsIncludeExact: ['call the plumber'],
        },
      },
    ],
  },
]
