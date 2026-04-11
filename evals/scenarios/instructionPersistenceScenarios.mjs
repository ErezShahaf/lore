const datedTodoSeedDocuments = [
  {
    content: 'renew passport',
    type: 'todo',
    date: '2026-03-01',
    tags: ['todo', 'travel'],
    source: 'eval-seed',
  },
  {
    content: 'book dentist',
    type: 'todo',
    date: '2026-03-10',
    tags: ['todo', 'health'],
    source: 'eval-seed',
  },
  {
    content: 'buy cat food',
    type: 'todo',
    date: '2026-03-18',
    tags: ['todo', 'pets'],
    source: 'eval-seed',
  },
]

export const instructionPersistenceScenarios = [
  {
    id: 'instruction-lists-todos-newest-first',
    topic: 'instruction-persistence',
    title: 'Todo ordering instruction is applied when listing todos',
    suites: ['smoke', 'full'],
    seedDocuments: datedTodoSeedDocuments,
    steps: [
      {
        userInput: 'From now on, when you list my todos, show them from newest to oldest.',
        expect: {
          storedCount: 1,
          todoCount: 3,
        },
      },
      {
        userInput: 'What are my todos?',
        expect: {
          todoCount: 3,
          responseJudge: 'The answer should list all three todos and order them newest to oldest by their saved dates: buy cat food first, then book dentist, then renew passport.',
          responseExcludes: ['From now on'],
        },
      },
    ],
  },
  {
    id: 'instruction-does-not-leak-into-unrelated-note-answer',
    topic: 'instruction-persistence',
    title: 'Todo-specific instruction does not distort unrelated note retrieval',
    suites: ['full'],
    seedDocuments: [
      ...datedTodoSeedDocuments,
      {
        content: 'Project Atlas launch owner is Dana.',
        type: 'note',
        date: '2026-03-12',
        tags: ['project', 'atlas', 'owner'],
        source: 'eval-seed',
      },
    ],
    steps: [
      {
        userInput: 'From now on, when you list my todos, show them from newest to oldest.',
        expect: {
          storedCount: 1,
        },
      },
      {
        userInput: 'Who owns Project Atlas?',
        expect: {
          minRetrievedCount: 1,
          maxRetrievedCount: 2,
          responseIncludes: ['Dana'],
          responseJudge: 'The answer should simply say that Dana owns Project Atlas. It should not turn the answer into a todo list or mention the saved todo-ordering instruction.',
        },
      },
    ],
  },
  {
    id: 'instruction-greeting-trigger-can-show-todos',
    topic: 'instruction-persistence',
    title: 'Greeting instruction can trigger a todo listing benchmark',
    suites: ['full'],
    seedDocuments: datedTodoSeedDocuments,
    steps: [
      {
        userInput: 'From now on, when I say good morning, show me my todos from newest to oldest.',
        expect: {
          storedCount: 1,
        },
      },
      {
        userInput: 'Good morning',
        expect: {
          responseJudge: 'The assistant should answer the greeting and show the user their todos from newest to oldest: buy cat food, then book dentist, then renew passport.',
        },
      },
    ],
  },
  {
    id: 'instruction-coexists-with-todo-creation',
    topic: 'instruction-persistence',
    title: 'Saved instruction stays separate while new todos are still created normally',
    suites: ['full'],
    steps: [
      {
        userInput: 'From now on, when you list my todos, show them from newest to oldest.',
        expect: {
          storedCount: 1,
          todoCount: 0,
        },
      },
      {
        userInput: 'Add to my todo list: submit expense report',
        expect: {
          storedCount: 1,
          todoCount: 1,
          todoContentsIncludeExact: ['submit expense report'],
        },
      },
      {
        userInput: 'What are my todos?',
        expect: {
          todoCount: 1,
          responseIncludes: ['submit expense report'],
          responseExcludes: ['From now on, when you list my todos'],
        },
      },
    ],
  },
  {
    id: 'instruction-list-order-survives-conversation-reset',
    topic: 'instruction-persistence',
    title: 'Todo list ordering instruction still applies after a fresh conversation',
    suites: ['full'],
    seedDocuments: datedTodoSeedDocuments,
    steps: [
      {
        userInput: 'From now on, when you list my todos, show them from newest to oldest.',
        expect: {
          storedCount: 1,
          todoCount: 3,
        },
      },
      {
        clearConversationBeforeStep: true,
        userInput: 'What are my todos?',
        expect: {
          todoCount: 3,
          responseJudge:
            'The answer should list all three todos and order them newest to oldest by their saved dates: buy cat food first, then book dentist, then renew passport.',
          responseExcludes: ['From now on'],
        },
      },
    ],
  },
]
