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
]
