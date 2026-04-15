export const todoCreationScenarios = [
  {
    id: 'add-single-todo-explicit',
    topic: 'todo-creation',
    title: 'Add a single explicit todo',
    suites: ['smoke', 'full', 'crucial'],
    steps: [
      {
        userInput: 'Add to my todo list: buy milk',
        expect: {
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
    suites: ['smoke', 'full', 'crucial'],
    steps: [
      {
        userInput: 'Todos: buy milk, call mom, pay rent',
        expect: {
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
    id: 'similar-todos-in-batch-no-false-duplicate-message',
    topic: 'todo-creation',
    title: 'Similar-structure todos in one batch do not report false duplicate',
    suites: ['full'],
    steps: [
      {
        userInput: 'add to my todo: run 5 miles, run 10 miles',
        expect: {
          storedCount: 2,
          todoCount: 2,
          todoContentsIncludeSubstrings: ['run 5 miles', 'run 10 miles'],
          responseExcludes: ['duplicate'],
          responseJudge: 'The response must not claim that one of the saved items was a duplicate when both items were stored successfully.',
        },
      },
    ],
  },
  {
    id: 'similar-todos-km-batch-no-false-duplicate-message',
    topic: 'todo-creation',
    title: 'Run 5 km and run 10 km in one batch both save without false duplicate',
    suites: ['full', 'crucial'],
    steps: [
      {
        userInput: 'todo: run 5 km, run 10 km',
        expect: {
          storedCount: 2,
          todoCount: 2,
          todoContentsIncludeSubstrings: ['run 5 km', 'run 10 km'],
          responseExcludes: ['duplicate'],
          responseJudge:
            'The response must not treat the 10 km task as a duplicate of the 5 km task when both distinct runs were stored successfully.',
        },
      },
    ],
  },
  {
    id: 'identical-todo-repeat-clarifies-before-second-copy',
    topic: 'todo-creation',
    title: 'Repeating the same todo add clarifies instead of silently duplicating',
    suites: ['full', 'crucial', 'problematic'],
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
          requiresClarification: true,
          storedCount: 0,
          todoCount: 1,
          todoContentsIncludeExact: ['call the plumber'],
          responseJudge:
            'The assistant should treat this as overlapping an existing todo with the same wording. It should ask what the user wants (for example add a second copy, keep one, or update)—not cheerfully confirm a second independent save as if nothing matched. It must not claim two separate todos were saved on this turn.',
        },
      },
    ],
  },
]
