const evalSeedSource = 'eval-seed'

const milkAndMomTodos = [
  {
    content: 'buy milk',
    type: 'todo',
    date: '2026-03-01',
    tags: ['todo'],
    source: evalSeedSource,
  },
  {
    content: 'call mom',
    type: 'todo',
    date: '2026-03-02',
    tags: ['todo'],
    source: evalSeedSource,
  },
]

const milkAndBreadTodos = [
  {
    content: 'buy milk',
    type: 'todo',
    date: '2026-03-01',
    tags: ['todo'],
    source: evalSeedSource,
  },
  {
    content: 'buy bread',
    type: 'todo',
    date: '2026-03-02',
    tags: ['todo'],
    source: evalSeedSource,
  },
]

const waterPairTodos = [
  {
    content: 'jump on the water',
    type: 'todo',
    date: '2026-03-01',
    tags: ['todo'],
    source: evalSeedSource,
  },
  {
    content: 'drink the water',
    type: 'todo',
    date: '2026-03-02',
    tags: ['todo'],
    source: evalSeedSource,
  },
]

const runMilePairTodos = [
  {
    content: 'run 5 mile',
    type: 'todo',
    date: '2026-03-01',
    tags: ['todo'],
    source: evalSeedSource,
  },
  {
    content: 'run 10 mile',
    type: 'todo',
    date: '2026-03-02',
    tags: ['todo'],
    source: evalSeedSource,
  },
]

const casualListTodos = [
  {
    content: 'renew passport',
    type: 'todo',
    date: '2026-03-01',
    tags: ['todo'],
    source: evalSeedSource,
  },
  {
    content: 'book dentist',
    type: 'todo',
    date: '2026-03-02',
    tags: ['todo'],
    source: evalSeedSource,
  },
  {
    content: 'buy oat milk',
    type: 'todo',
    date: '2026-03-03',
    tags: ['todo'],
    source: evalSeedSource,
  },
]

export const newChatTodoScenarios = [
  {
    id: 'new-chat-seeded-casual-todo-list',
    topic: 'todo-new-chat',
    title: 'Cold thread: casual wording lists seeded todos',
    suites: ['smoke', 'full'],
    seedDocuments: casualListTodos,
    steps: [
      {
        userInput: 'What do I still need to do?',
        expect: {
          todoCount: 3,
          responseIncludes: ['renew passport', 'book dentist', 'buy oat milk'],
        },
      },
    ],
  },
  {
    id: 'new-chat-seeded-update-milk-todo',
    topic: 'todo-new-chat',
    title: 'Cold thread: update a specific seeded todo by description',
    suites: ['full'],
    seedDocuments: milkAndMomTodos,
    steps: [
      {
        userInput: 'Change the todo about milk to buy oat milk',
        expect: {
          todoCount: 2,
          todoContentsIncludeSubstrings: ['buy oat milk', 'call mom'],
          todoContentsExcludeExact: ['buy milk'],
          dataJudge:
            'After the update, one todo should still represent calling mom and the milk-related todo should now represent buying oat milk rather than plain milk.',
        },
      },
    ],
  },
  {
    id: 'new-chat-seeded-delete-milk-todo',
    topic: 'todo-new-chat',
    title: 'Cold thread: delete one seeded todo by description',
    suites: ['full'],
    seedDocuments: milkAndBreadTodos,
    steps: [
      {
        userInput: 'Remove the todo about milk',
        expect: {
          deletedCount: 1,
          todoCount: 1,
          todoContentsIncludeExact: ['buy bread'],
          todoContentsExcludeExact: ['buy milk'],
        },
      },
    ],
  },
  {
    id: 'new-chat-seeded-ambiguous-delete-water-needs-clarification',
    topic: 'todo-new-chat',
    title: 'Cold thread: ambiguous delete on seeded water todos waits for user',
    suites: ['full'],
    seedDocuments: waterPairTodos,
    steps: [
      {
        userInput: 'Delete the water one',
        expect: {
          requiresClarification: true,
          todoCount: 2,
          deletedCount: 0,
        },
      },
    ],
  },
  {
    id: 'new-chat-seeded-ambiguous-update-water-needs-clarification',
    topic: 'todo-new-chat',
    title: 'Cold thread: ambiguous update on seeded water todos waits for user',
    suites: ['full'],
    seedDocuments: waterPairTodos,
    steps: [
      {
        userInput: 'Edit the water to fire',
        expect: {
          requiresClarification: true,
          todoCount: 2,
          todoContentsIncludeExact: ['jump on the water', 'drink the water'],
          todoContentsExcludeSubstrings: ['fire'],
        },
      },
    ],
  },
  {
    id: 'new-chat-seeded-ambiguous-finished-run-needs-clarification',
    topic: 'todo-new-chat',
    title: 'Cold thread: ambiguous run completion on seeded run todos waits for user',
    suites: ['full'],
    seedDocuments: runMilePairTodos,
    steps: [
      {
        userInput: 'just finished the run',
        expect: {
          requiresClarification: true,
          deletedCount: 0,
          todoCount: 2,
          responseJudge:
            'The assistant should explain that multiple run-related todos match and ask which one the user completed. It must not delete any todo without clarification.',
        },
      },
    ],
  },
  {
    id: 'new-chat-seeded-ambiguous-run-delete-numeric-follow-up',
    topic: 'todo-new-chat',
    title: 'Cold thread: numeric reply after seeded run delete clarification executes',
    suites: ['full'],
    seedDocuments: runMilePairTodos,
    steps: [
      {
        userInput: 'delete the run',
        expect: {
          requiresClarification: true,
          deletedCount: 0,
          todoCount: 2,
        },
      },
      {
        userInput: '2',
        expect: {
          deletedCount: 1,
          todoCount: 1,
          todoContentsIncludeExact: ['run 10 mile'],
          todoContentsExcludeExact: ['run 5 mile'],
          responseJudge:
            'The assistant should treat "2" as selecting the second numbered option from the prior clarification list (the 5-mile run), complete that deletion, and confirm—without restarting clarification or acting confused.',
        },
      },
    ],
  },
  {
    id: 'new-chat-seeded-ambiguous-delete-water-natural-language-follow-up',
    topic: 'todo-new-chat',
    title: 'Cold thread: natural language resolves ambiguous delete on seeded water todos',
    suites: ['full'],
    seedDocuments: waterPairTodos,
    steps: [
      {
        userInput: 'Delete the water one',
        expect: {
          requiresClarification: true,
          deletedCount: 0,
          todoCount: 2,
        },
      },
      {
        userInput: 'Delete the one about drinking water.',
        expect: {
          deletedCount: 1,
          todoCount: 1,
          todoContentsIncludeExact: ['jump on the water'],
          todoContentsExcludeExact: ['drink the water'],
        },
      },
    ],
  },
  {
    id: 'new-chat-reset-after-user-created-todos-ambiguous-delete-resolves',
    topic: 'todo-new-chat',
    title: 'Fresh conversation after user created todos: ambiguous delete then resolution',
    suites: ['full'],
    steps: [
      {
        userInput: 'Todos: jump on the water, drink the water',
        expect: {
          storedCount: 2,
          todoCount: 2,
        },
      },
      {
        clearConversationBeforeStep: true,
        userInput: 'Delete the water one',
        expect: {
          requiresClarification: true,
          deletedCount: 0,
          todoCount: 2,
        },
      },
      {
        userInput: 'Delete the one about drinking water.',
        expect: {
          deletedCount: 1,
          todoCount: 1,
          todoContentsIncludeExact: ['jump on the water'],
          todoContentsExcludeExact: ['drink the water'],
        },
      },
    ],
  },
]
