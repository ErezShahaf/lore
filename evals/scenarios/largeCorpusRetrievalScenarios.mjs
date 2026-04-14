function buildTopicArticleDocuments(topicPrefix, topicTags, articleCount) {
  return Array.from({ length: articleCount }, (_unused, index) => ({
    content: `${topicPrefix} article ${index + 1}: background notes about ${topicPrefix.toLowerCase()} topic ${index + 1}, with routine examples and no target facts.`,
    type: 'thought',
    tags: [...topicTags],
    source: 'eval-seed',
  }))
}

function buildLargeMixedCorpusSeedDocuments() {
  return [
    ...buildTopicArticleDocuments('Payments', ['payments', 'finance'], 20),
    ...buildTopicArticleDocuments('Travel', ['travel', 'itinerary'], 20),
    ...buildTopicArticleDocuments('Books', ['books', 'reading'], 20),
    ...buildTopicArticleDocuments('Engineering', ['engineering', 'guides'], 20),
    {
      content: 'Payments operations guide: webhook retries should use exponential backoff at 10 seconds, 30 seconds, and 5 minutes before alerting an operator.',
      type: 'note',
      tags: ['payments', 'webhooks', 'retries', 'backoff'],
      source: 'eval-seed',
    },
    {
      content: 'Travel plan for Kyoto tea shops: on day two visit Ippodo first, then walk to the Kiyomizu area in the afternoon.',
      type: 'note',
      tags: ['travel', 'kyoto', 'tea'],
      source: 'eval-seed',
    },
    {
      content: 'Short story note: The Glass Lighthouse ends with Mira returning the blue compass to the harbor wall.',
      type: 'note',
      tags: ['books', 'story', 'glass-lighthouse'],
      source: 'eval-seed',
    },
    {
      content: 'Project Atlas onboarding and deployment checklist: rotate webhook secrets immediately after cutover and verify the fallback endpoint.',
      type: 'note',
      tags: ['engineering', 'atlas', 'deployment', 'onboarding', 'webhooks'],
      source: 'eval-seed',
    },
    {
      content: 'Reading note about the book Atlas of Quiet Streets: the chapter on onboarding focuses on how newcomers learn neighborhood rituals.',
      type: 'note',
      tags: ['books', 'atlas', 'onboarding'],
      source: 'eval-seed',
    },
    {
      content: 'Engineering reference URL for the fallback webhook endpoint: https://example.com/lore/platform/fallback-webhook',
      type: 'note',
      tags: ['engineering', 'webhooks', 'url', 'fallback'],
      source: 'eval-seed',
    },
  ]
}

export const largeCorpusRetrievalScenarios = [
  {
    id: 'large-corpus-webhook-retry-guide-stays-focused',
    topic: 'large-corpus-retrieval',
    title: 'Large corpus retrieval keeps a webhook retry answer focused',
    suites: ['full'],
    seedDocuments: buildLargeMixedCorpusSeedDocuments(),
    steps: [
      {
        userInput: 'What retry schedule did I save for webhook failures?',
        expect: {
          minRetrievedCount: 1,
          maxRetrievedCount: 12,
          retrievedContentsIncludeSubstrings: ['10 seconds, 30 seconds, and 5 minutes'],
          responseJudge: 'The answer should say that webhook retries use exponential backoff at 10 seconds, 30 seconds, and 5 minutes, without pulling in unrelated travel, book, or generic engineering notes.',
          retrievalJudge: 'The retrieval set should stay tightly focused on the webhook retry guide and should not include a wide spread of unrelated large-corpus documents.',
        },
      },
    ],
  },
  {
    id: 'large-corpus-kyoto-tea-paraphrase-stays-focused',
    topic: 'large-corpus-retrieval',
    title: 'Large corpus travel retrieval works from paraphrased wording',
    suites: ['full'],
    seedDocuments: buildLargeMixedCorpusSeedDocuments(),
    steps: [
      {
        userInput: 'Which tea shop did I want to hit first on the Kyoto day?',
        expect: {
          minRetrievedCount: 1,
          maxRetrievedCount: 12,
          retrievedContentsIncludeSubstrings: ['visit Ippodo first'],
          responseIncludes: ['Ippodo'],
          retrievalJudge: 'The retrieval should stay focused on the Kyoto tea itinerary and avoid unrelated notes from the large mixed corpus.',
        },
      },
    ],
  },
  {
    id: 'large-corpus-story-ending-retrieval-by-description',
    topic: 'large-corpus-retrieval',
    title: 'Large corpus story retrieval answers from an explained description',
    suites: ['full'],
    seedDocuments: buildLargeMixedCorpusSeedDocuments(),
    steps: [
      {
        userInput: 'In that story about the lighthouse, what did Mira return at the end?',
        expect: {
          minRetrievedCount: 1,
          maxRetrievedCount: 12,
          retrievedContentsIncludeSubstrings: ['Mira returning the blue compass'],
          responseJudge: 'The answer should clearly say that Mira returned the blue compass at the end of The Glass Lighthouse and should not blend in facts from unrelated documents.',
        },
      },
    ],
  },
  {
    id: 'large-corpus-ambiguous-atlas-reference-needs-clarification',
    topic: 'large-corpus-retrieval',
    title: 'Large corpus ambiguity asks which Atlas note the user means',
    suites: ['full'],
    seedDocuments: buildLargeMixedCorpusSeedDocuments(),
    steps: [
      {
        userInput: 'What did Atlas say about onboarding?',
        expect: {
          requiresClarification: true,
          minRetrievedCount: 2,
          maxRetrievedCount: 12,
          retrievedContentsIncludeSubstrings: ['Project Atlas', 'Atlas of Quiet Streets'],
          responseJudge: 'The assistant should explain that there are at least two plausible Atlas matches in the saved data and ask whether the user means Project Atlas or the book note Atlas of Quiet Streets before answering.',
        },
      },
    ],
  },
  {
    id: 'large-corpus-specific-url-retrieval-stays-focused',
    topic: 'large-corpus-retrieval',
    title: 'Large corpus URL retrieval returns the precise saved endpoint',
    suites: ['full'],
    seedDocuments: buildLargeMixedCorpusSeedDocuments(),
    steps: [
      {
        userInput: 'What was the fallback webhook endpoint URL I saved?',
        expect: {
          minRetrievedCount: 1,
          maxRetrievedCount: 12,
          retrievedContentsIncludeSubstrings: ['fallback webhook endpoint'],
          responseMatchesRegex: ['https://example\\.com/lore/platform/fallback-webhook'],
        },
      },
    ],
  },
]
