export const conversationRobustnessScenarios = [
  {
    id: 'greeting-then-add-todo',
    topic: 'conversation-robustness',
    title: 'Greeting before task creation',
    suites: ['smoke', 'full'],
    steps: [
      {
        userInput: 'Hey, how are you today?',
        expect: {
          todoCount: 0,
        },
      },
      {
        userInput: 'Nice. Add to my todo list: stretch for ten minutes',
        expect: {
          storedCount: 1,
          todoCount: 1,
          todoContentsIncludeSubstrings: ['stretch for ten minutes'],
        },
      },
    ],
  },
  {
    id: 'smalltalk-random-question-then-add',
    topic: 'conversation-robustness',
    title: 'Random smalltalk before action',
    suites: ['full'],
    steps: [
      {
        userInput: 'Hello! Quick question, what is your favorite color?',
        expect: {
          todoCount: 0,
        },
      },
      {
        userInput: 'Anyway, add to my todo list: buy new headphones',
        expect: {
          storedCount: 1,
          todoCount: 1,
          todoContentsIncludeSubstrings: ['buy new headphones'],
        },
      },
    ],
  },
  {
    id: 'pure-greeting-does-not-store',
    topic: 'conversation-robustness',
    title: 'Greeting alone does not create data',
    suites: ['full'],
    steps: [
      {
        userInput: 'Hi there!',
        expect: {
          todoCount: 0,
        },
      },
    ],
  },
]
