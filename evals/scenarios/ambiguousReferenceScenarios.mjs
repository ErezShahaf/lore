export const ambiguousReferenceScenarios = [
  {
    id: 'ambiguous-ride-completion-needs-clarification',
    topic: 'ambiguous-reference',
    title: 'Ambiguous completion request asks which ride todo to remove',
    suites: ['smoke', 'full'],
    steps: [
      {
        userInput: 'Todos: ride a dragon, ride a motorcycle, ride a bike, ride a woman',
        expect: {
          storedCount: 4,
          todoCount: 4,
        },
      },
      {
        userInput: 'I already finished the ride',
        expect: {
          requiresClarification: true,
          deletedCount: 0,
          todoCount: 4,
          responseJudge: 'The assistant should explain that several ride-related todos match and ask which one the user completed.',
        },
      },
    ],
  },
  {
    id: 'ambiguous-ride-completion-follow-up-selects-motorcycle',
    topic: 'ambiguous-reference',
    title: 'Clarification follow-up can pick the motorcycle todo',
    suites: ['full'],
    steps: [
      {
        userInput: 'Todos: ride a dragon, ride a motorcycle, ride a bike, ride a woman',
        expect: {
          storedCount: 4,
          todoCount: 4,
        },
      },
      {
        userInput: 'I already finished the ride',
        expect: {
          requiresClarification: true,
          deletedCount: 0,
          todoCount: 4,
        },
      },
      {
        userInput: 'The motorcycle one.',
        expect: {
          deletedCount: 1,
          todoCount: 3,
          todoContentsIncludeExact: ['ride a dragon', 'ride a bike', 'ride a woman'],
          todoContentsExcludeExact: ['ride a motorcycle'],
        },
      },
    ],
  },
  {
    id: 'ambiguous-ride-completion-numeric-follow-up-executes',
    topic: 'ambiguous-reference',
    title: 'Numeric clarification reply executes without restating the task',
    suites: ['full'],
    steps: [
      {
        userInput: 'Todos: ride a dragon, ride a motorcycle, ride a bike, ride a woman',
        expect: {
          storedCount: 4,
          todoCount: 4,
        },
      },
      {
        userInput: 'I already finished the ride',
        expect: {
          requiresClarification: true,
          deletedCount: 0,
          todoCount: 4,
        },
      },
      {
        userInput: '1',
        expect: {
          deletedCount: 1,
          todoCount: 3,
          responseJudge: 'The assistant should treat "1" as a clarification follow-up selecting one of the previously numbered candidates. It should complete one deletion and confirm the change instead of restarting the whole clarification flow or acting confused.',
        },
      },
    ],
  },
  {
    id: 'ambiguous-ride-edit-follow-up-updates-target',
    topic: 'ambiguous-reference',
    title: 'Clarification follow-up can update the intended ride todo',
    suites: ['smoke', 'full'],
    steps: [
      {
        userInput: 'Todos: ride a dragon, ride a motorcycle, ride a bike',
        expect: {
          storedCount: 3,
          todoCount: 3,
        },
      },
      {
        userInput: 'Edit the ride to ride a banana',
        expect: {
          requiresClarification: true,
          todoCount: 3,
          todoContentsIncludeExact: ['ride a dragon', 'ride a motorcycle', 'ride a bike'],
          todoContentsExcludeSubstrings: ['banana'],
        },
      },
      {
        userInput: 'The motorcycle one',
        expect: {
          todoCount: 3,
          todoContentsIncludeExact: ['ride a dragon', 'ride a bike'],
          todoContentsIncludeSubstrings: ['ride a banana'],
          todoContentsExcludeExact: ['ride a motorcycle'],
        },
      },
    ],
  },
  {
    id: 'ambiguous-water-delete-repair-after-correction',
    topic: 'ambiguous-reference',
    title: 'Follow-up correction after ambiguity deletes the intended water todo',
    suites: ['full'],
    steps: [
      {
        userInput: 'Todos: jump on the water, drink the water, water the plants',
        expect: {
          storedCount: 3,
          todoCount: 3,
        },
      },
      {
        userInput: 'Delete the water one',
        expect: {
          requiresClarification: true,
          deletedCount: 0,
          todoCount: 3,
        },
      },
      {
        userInput: 'No, the one about drinking water.',
        expect: {
          deletedCount: 1,
          todoCount: 2,
          todoContentsIncludeExact: ['jump on the water', 'water the plants'],
          todoContentsExcludeExact: ['drink the water'],
        },
      },
    ],
  },
]
