function buildNoiseThoughtDocuments(prefix, count) {
  return Array.from({ length: count }, (_unused, index) => ({
    content: `${prefix} note ${index + 1}: unrelated planning detail ${index + 1}.`,
    type: 'thought',
    tags: ['noise'],
    source: 'eval-seed',
  }))
}

export const memoryRetrievalScenarios = [
  {
    id: 'seeded-large-db-targeted-retrieval',
    topic: 'memory-retrieval',
    title: 'Retrieve the right fact from seeded large data',
    suites: ['full'],
    seedDocuments: [
      ...buildNoiseThoughtDocuments('Travel', 12),
      ...buildNoiseThoughtDocuments('Work', 12),
      {
        content: 'Farmers market list for Saturday: apples, pears, basil.',
        type: 'thought',
        tags: ['shopping', 'market', 'groceries'],
        source: 'eval-seed',
      },
      {
        content: 'Remember to book the dentist for next month.',
        type: 'thought',
        tags: ['health'],
        source: 'eval-seed',
      },
    ],
    steps: [
      {
        userInput: 'What did I want to buy from the farmers market?',
        expect: {
          minRetrievedCount: 1,
          maxRetrievedCount: 10,
          retrievedContentsIncludeSubstrings: ['Farmers market list'],
          responseJudge: 'The answer should clearly mention apples, pears, and basil as the farmers market items, and should not introduce unrelated seeded notes.',
        },
      },
    ],
  },
  {
    id: 'seeded-ambiguous-retrieval-needs-clarification',
    topic: 'memory-retrieval',
    title: 'Seeded retrieval ambiguity asks for clarification',
    suites: ['full'],
    seedDocuments: [
      ...buildNoiseThoughtDocuments('Project', 10),
      {
        content: 'Alex from design asked for a darker sidebar and tighter spacing.',
        type: 'thought',
        tags: ['alex', 'design', 'ui'],
        source: 'eval-seed',
      },
      {
        content: 'Alex from finance asked for monthly cash flow summaries in the report.',
        type: 'thought',
        tags: ['alex', 'finance', 'reporting'],
        source: 'eval-seed',
      },
    ],
    steps: [
      {
        userInput: 'What did Alex ask for?',
        expect: {
          requiresClarification: true,
          minRetrievedCount: 2,
          maxRetrievedCount: 16,
          retrievedContentsIncludeSubstrings: ['Alex from design', 'Alex from finance'],
          responseJudge: 'The assistant should explain that there are at least two plausible Alex matches and ask the user to clarify which Alex they mean before answering.',
        },
      },
    ],
  },
  {
    id: 'seeded-ambiguous-retrieval-clarification-resolves',
    topic: 'memory-retrieval',
    title: 'Seeded retrieval clarification leads to the right Alex',
    suites: ['full'],
    seedDocuments: [
      ...buildNoiseThoughtDocuments('Project', 10),
      {
        content: 'Alex from design asked for a darker sidebar and tighter spacing.',
        type: 'thought',
        tags: ['alex', 'design', 'ui'],
        source: 'eval-seed',
      },
      {
        content: 'Alex from finance asked for monthly cash flow summaries in the report.',
        type: 'thought',
        tags: ['alex', 'finance', 'reporting'],
        source: 'eval-seed',
      },
    ],
    steps: [
      {
        userInput: 'What did Alex ask for?',
        simulatedUser: {
          userGoal: 'Find out what Alex from finance asked for.',
          maxAssistantTurns: 3,
          clarificationResponses: [
            {
              id: 'choose-finance-alex',
              label: 'Choose the finance Alex',
              triggerRubric: 'The assistant is asking the user to clarify which Alex they mean because there are multiple plausible Alex matches.',
              userInput: 'I mean Alex from finance.',
            },
          ],
        },
        expect: {
          clarificationRequestedDuringInteraction: true,
          minRetrievedCount: 1,
          maxRetrievedCount: 8,
          retrievedContentsIncludeSubstrings: ['Alex from finance'],
          responseJudge: 'After the clarification, the final answer should clearly say that Alex from finance asked for monthly cash flow summaries in the report.',
        },
      },
    ],
  },
  {
    id: 'seeded-retrieval-threshold-discipline',
    topic: 'memory-retrieval',
    title: 'Seeded retrieval keeps the result set focused',
    suites: ['full'],
    seedDocuments: [
      ...buildNoiseThoughtDocuments('City', 8),
      {
        content: 'Tokyo restaurant shortlist: Sushi Saito.',
        type: 'thought',
        tags: ['tokyo', 'restaurant', 'food'],
        source: 'eval-seed',
      },
      {
        content: 'Tokyo hotel shortlist: Hoshinoya Tokyo.',
        type: 'thought',
        tags: ['tokyo', 'hotel', 'travel'],
        source: 'eval-seed',
      },
      {
        content: 'Kyoto restaurant shortlist: Monk.',
        type: 'thought',
        tags: ['kyoto', 'restaurant', 'food'],
        source: 'eval-seed',
      },
      {
        content: 'Tokyo subway tip: use the Suica card for easier transfers.',
        type: 'thought',
        tags: ['tokyo', 'subway', 'travel'],
        source: 'eval-seed',
      },
    ],
    steps: [
      {
        userInput: 'Which Tokyo restaurant did I want to try?',
        expect: {
          minRetrievedCount: 1,
          maxRetrievedCount: 12,
          retrievedContentsIncludeSubstrings: ['Tokyo restaurant shortlist'],
          responseJudge: 'The answer should identify Sushi Saito as the Tokyo restaurant and should not mention the hotel, subway tip, or Kyoto restaurant as if they answered the question.',
        },
      },
    ],
  },
  {
    id: 'seeded-analytics-json-verbatim-in-answer',
    topic: 'memory-retrieval',
    title: 'Analytics-shaped note is returned as stored JSON not paraphrased',
    suites: ['full'],
    seedDocuments: [
      ...buildNoiseThoughtDocuments('Misc', 6),
      {
        content:
          'Session analytics export\n\n{"userId":"pixelNomad","clicks":137,"conversionRatePercent":4.2,"recentEvents":["page_view","purchase"]}',
        type: 'thought',
        tags: ['analytics', 'session'],
        source: 'eval-seed',
      },
    ],
    steps: [
      {
        userInput: 'Show me the session analytics JSON I saved with pixelNomad and the click counts.',
        expect: {
          minRetrievedCount: 1,
          maxRetrievedCount: 10,
          retrievedContentsIncludeSubstrings: ['pixelNomad'],
          responseCodeBlockJsonIncludesFields: {
            userId: 'pixelNomad',
            clicks: '137',
            conversionRatePercent: '4.2',
          },
          responseJudge:
            'The answer must include the saved JSON in a markdown code block so the user sees their data as stored, not only a prose summary that rewrites metrics in different words.',
        },
      },
    ],
  },
]
