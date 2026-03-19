export const todoUpdateScenarios = [
  {
    id: 'update-specific-todo',
    topic: 'todo-update',
    title: 'Update a specific todo by description',
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
        userInput: 'Change the todo about milk to buy oat milk',
        expect: {
          todoCount: 2,
          todoContentsIncludeSubstrings: ['buy oat milk', 'call mom'],
          todoContentsExcludeExact: ['buy milk'],
          dataJudge: 'After the update, one todo should still represent calling mom and the milk-related todo should now represent buying oat milk rather than plain milk.',
        },
      },
    ],
  },
  {
    id: 'ambiguous-update-needs-clarification',
    topic: 'todo-update',
    title: 'Ambiguous update asks for clarification',
    suites: ['smoke', 'full'],
    steps: [
      {
        userInput: 'Todos: jump on the water, drink the water',
        expect: {
          storedCount: 2,
          todoCount: 2,
        },
      },
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
    id: 'clarification-resolves-ambiguous-update',
    topic: 'todo-update',
    title: 'Clarification follow-up resolves the right todo',
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
        userInput: 'Edit the water to fire',
        simulatedUser: {
          userGoal: 'Change the todo about drinking water so it becomes "drink the fire".',
          maxAssistantTurns: 3,
          clarificationResponses: [
            {
              id: 'choose-drinking-todo',
              label: 'Choose the drinking todo',
              triggerRubric: 'The assistant is asking the user to clarify which water-related todo should be updated.',
              userInput: 'The one about drinking. Change it to drink the fire.',
            },
          ],
        },
        expect: {
          clarificationRequestedDuringInteraction: true,
          todoCount: 2,
          todoContentsIncludeSubstrings: ['jump on the water', 'drink the fire'],
          todoContentsExcludeExact: ['drink the water'],
        },
      },
    ],
  },
  {
    id: 'explicit-edit-similar-todos',
    topic: 'todo-update',
    title: 'Explicit edit of one similar todo',
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
        userInput: 'Change "jump on the water" to "jump on the fire"',
        expect: {
          todoCount: 2,
          todoContentsIncludeSubstrings: ['jump on the fire', 'drink the water'],
          todoContentsExcludeExact: ['jump on the water'],
        },
      },
    ],
  },
]
