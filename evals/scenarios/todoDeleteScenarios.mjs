export const todoDeleteScenarios = [
  {
    id: 'delete-specific-todo',
    topic: 'todo-delete',
    title: 'Delete one matching todo',
    suites: ['smoke', 'full'],
    steps: [
      {
        userInput: 'Todos: buy milk, buy bread',
        expect: {
          storedCount: 2,
          todoCount: 2,
        },
      },
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
    id: 'ambiguous-delete-needs-clarification',
    topic: 'todo-delete',
    title: 'Ambiguous delete does not act immediately',
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
    id: 'clarification-resolves-ambiguous-delete',
    topic: 'todo-delete',
    title: 'Clarification follow-up deletes the intended todo',
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
        userInput: 'Delete the water one',
        simulatedUser: {
          userGoal: 'Delete the todo about drinking water, not the jumping one.',
          maxAssistantTurns: 3,
          clarificationResponses: [
            {
              id: 'delete-drinking-todo',
              label: 'Delete the drinking todo',
              triggerRubric: 'The assistant is asking the user to clarify which water-related todo should be deleted.',
              userInput: 'Delete the one about drinking water.',
            },
          ],
        },
        expect: {
          clarificationRequestedDuringInteraction: true,
          deletedCount: 1,
          todoCount: 1,
          todoContentsIncludeExact: ['jump on the water'],
          todoContentsExcludeExact: ['drink the water'],
        },
      },
    ],
  },
  {
    id: 'delete-todos-when-completion-mentions-listed-items',
    topic: 'todo-delete',
    title: 'Delete completed todos after user confirms',
    suites: ['smoke', 'full'],
    seedDocuments: [
      {
        content: 'Launch Lore on Product Hunt',
        type: 'todo',
        date: '2026-03-01',
        tags: ['todo', 'product-hunt'],
        source: 'eval-seed',
      },
      {
        content: 'show lore to Dana',
        type: 'todo',
        date: '2026-03-02',
        tags: ['todo', 'dana'],
        source: 'eval-seed',
      },
      {
        content: 'show lore to Yael',
        type: 'todo',
        date: '2026-03-03',
        tags: ['todo', 'yael'],
        source: 'eval-seed',
      },
      {
        content: 'have a different db for Lore dev and Lore that I\'m using for myself',
        type: 'todo',
        date: '2026-03-04',
        tags: ['todo', 'lore-dev'],
        source: 'eval-seed',
      },
      {
        content: 'fix bug some text is sticked to the right',
        type: 'todo',
        date: '2026-03-05',
        tags: ['todo', 'bugfix'],
        source: 'eval-seed',
      },
      {
        content: 'implement testing framework and write tests',
        type: 'todo',
        date: '2026-03-06',
        tags: ['todo', 'testing'],
        source: 'eval-seed',
      },
    ],
    steps: [
      {
        userInput: 'whats on my todo',
        expect: {
          todoCount: 6,
        },
      },
      {
        userInput:
          'nice, about that product hunt its done and dana and yael already saw it.. Oh! the dev lore is done too and the testing framework is also in place',
        expect: {
          responseExcludes: ['saved'],
          deletedCount: 5,
          todoCount: 1,
          todoContentsIncludeSubstrings: ['fix bug some text is sticked to the right'],
          todoContentsExcludeSubstrings: [
            'Launch Lore on Product Hunt',
            'show lore to Dana',
            'show lore to Yael',
            'have a different db for Lore dev and Lore that I\'m using for myself',
            'implement testing framework and write tests',
          ],
        },
      },
    ],
  },
]
