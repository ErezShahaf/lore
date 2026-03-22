export const ambiguousReferenceScenarios = [
  {
    id: 'ambiguous-run-completion-needs-clarification',
    topic: 'ambiguous-reference',
    title: 'Ambiguous "just finished the run" asks which run todo to remove',
    suites: ['full'],
    steps: [
      {
        userInput: 'Todos: run 5 mile, run 10 mile',
        expect: {
          storedCount: 2,
          todoCount: 2,
        },
      },
      {
        userInput: 'just finished the run',
        expect: {
          requiresClarification: true,
          deletedCount: 0,
          todoCount: 2,
          responseJudge: 'The assistant should explain that multiple run-related todos match and ask which one the user completed. It must not delete any todo without clarification.',
        },
      },
    ],
  },
  {
    id: 'ambiguous-run-completion-numeric-follow-up-executes',
    topic: 'ambiguous-reference',
    title: 'Numeric "1" after run clarification executes delete',
    suites: ['full'],
    steps: [
      {
        userInput: 'Todos: run 5 km, run 6 km',
        expect: {
          storedCount: 2,
          todoCount: 2,
        },
      },
      {
        userInput: 'i finished the run',
        expect: {
          requiresClarification: true,
          deletedCount: 0,
          todoCount: 2,
        },
      },
      {
        userInput: '1',
        expect: {
          deletedCount: 1,
          todoCount: 1,
          responseJudge: 'The assistant should treat "1" as a clarification follow-up selecting one of the previously numbered candidates. It should complete one deletion and confirm the change instead of restarting the whole clarification flow or acting confused.',
        },
      },
    ],
  },
  {
    id: 'ambiguous-ride-completion-needs-clarification',
    topic: 'ambiguous-reference',
    title: 'Ambiguous completion request asks which ride todo to remove',
    suites: ['smoke', 'full'],
    steps: [
      {
        userInput: 'Todos: ride a dragon, ride a motorcycle, ride a bike, ride a turtle',
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
        userInput: 'Todos: ride a dragon, ride a motorcycle, ride a bike, ride a turtle',
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
          todoContentsIncludeExact: ['ride a dragon', 'ride a bike', 'ride a turtle'],
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
        userInput: 'Todos: ride a dragon, ride a motorcycle, ride a bike, ride a turtle',
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
  {
    id: 'ambiguous-run-delete-exact-content-follow-up-executes',
    topic: 'ambiguous-reference',
    title: 'Exact content follow-up after clarification executes delete',
    suites: ['full'],
    steps: [
      {
        userInput: 'Todos: run 5 mile, run 10 mile',
        expect: {
          storedCount: 2,
          todoCount: 2,
        },
      },
      {
        userInput: 'delete the run',
        expect: {
          requiresClarification: true,
          deletedCount: 0,
          todoCount: 2,
        },
      },
      {
        userInput: 'run 5 mile',
        expect: {
          deletedCount: 1,
          todoCount: 1,
          todoContentsIncludeExact: ['run 10 mile'],
          todoContentsExcludeExact: ['run 5 mile'],
          responseJudge: 'The assistant should treat "run 5 mile" as selecting that specific option from the clarification list. It should complete the deletion and confirm instead of asking again.',
        },
      },
    ],
  },
  {
    id: 'ambiguous-ten-times-completion-offers-all-option',
    topic: 'ambiguous-reference',
    title: 'Ambiguous ten-times completion lists matches and offers an all option',
    suites: ['full'],
    steps: [
      {
        userInput: 'Todos: cry 10 times, clean 10 times, slide b duck, jump 10 times, run 10 times',
        expect: {
          storedCount: 5,
          todoCount: 5,
        },
      },
      {
        userInput: 'i finished the 10 times',
        expect: {
          requiresClarification: true,
          deletedCount: 0,
          todoCount: 5,
          responseJudge:
            'The assistant should treat several todos as matching "10 times" (cry, clean, jump, run) and ask the user to narrow which one they mean. It must also explicitly offer that the user may have finished all of those matching ten-times tasks (for example by asking whether they mean all of them, every ten-times task, or all four), not only "which specific one" with no way to choose every matching todo.',
        },
      },
    ],
  },
  {
    id: 'ambiguous-ten-times-completion-all-follow-up-removes-four',
    topic: 'ambiguous-reference',
    title: 'Follow-up can complete every ten-times todo at once',
    suites: ['full'],
    steps: [
      {
        userInput: 'Todos: cry 10 times, clean 10 times, slide b duck, jump 10 times, run 10 times',
        expect: {
          storedCount: 5,
          todoCount: 5,
        },
      },
      {
        userInput: 'i finished the 10 times',
        expect: {
          requiresClarification: true,
          deletedCount: 0,
          todoCount: 5,
        },
      },
      {
        userInput: 'I meant all four ten-times tasks.',
        expect: {
          deletedCount: 4,
          todoCount: 1,
          todoContentsIncludeExact: ['slide b duck'],
          todoContentsExcludeExact: ['cry 10 times', 'clean 10 times', 'jump 10 times', 'run 10 times'],
        },
      },
    ],
  },
]
