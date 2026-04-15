const technicalReferenceSeedDocuments = [
  {
    content: 'Stripe checkout.session.completed webhook URL: https://example.com/lore/stripe/checkout-session-completed',
    type: 'note',
    tags: ['stripe', 'webhook', 'checkout.session.completed', 'payments'],
    source: 'eval-seed',
  },
  {
    content: 'Stripe payment_intent.payment_failed webhook URL: https://example.com/lore/stripe/payment-failed',
    type: 'note',
    tags: ['stripe', 'webhook', 'payment_intent.payment_failed', 'payments'],
    source: 'eval-seed',
  },
  {
    content: 'Stripe customer.subscription.updated webhook URL: https://example.com/lore/stripe/subscription-updated',
    type: 'note',
    tags: ['stripe', 'webhook', 'customer.subscription.updated', 'billing'],
    source: 'eval-seed',
  },
  {
    content: 'Adyen payment AUTHORISATION notification webhook URL: https://example.com/lore/adyen/authorisation',
    type: 'note',
    tags: ['adyen', 'webhook', 'authorisation', 'payments'],
    source: 'eval-seed',
  },
  {
    content: 'Adyen payment CAPTURE notification webhook URL: https://example.com/lore/adyen/capture',
    type: 'note',
    tags: ['adyen', 'webhook', 'capture', 'payments'],
    source: 'eval-seed',
  },
]

export const technicalReferenceRetrievalScenarios = [
  {
    id: 'stripe-checkout-webhook-url-by-paraphrase',
    topic: 'technical-reference-retrieval',
    title: 'Stripe checkout webhook URL can be found from paraphrased wording',
    suites: ['smoke', 'full', 'crucial'],
    seedDocuments: technicalReferenceSeedDocuments,
    steps: [
      {
        userInput: 'What endpoint did I save for the Stripe checkout completed event?',
        expect: {
          minRetrievedCount: 1,
          maxRetrievedCount: 8,
          retrievedContentsIncludeSubstrings: ['checkout.session.completed'],
          responseMatchesRegex: ['https://example\\.com/lore/stripe/checkout-session-completed'],
        },
      },
    ],
  },
  {
    id: 'stripe-payment-failed-webhook-url-by-different-phrasing',
    topic: 'technical-reference-retrieval',
    title: 'Stripe payment failure webhook can be retrieved from alternate phrasing',
    suites: ['full'],
    seedDocuments: technicalReferenceSeedDocuments,
    steps: [
      {
        userInput: 'Show me the Stripe webhook for failed payment intents.',
        expect: {
          minRetrievedCount: 1,
          maxRetrievedCount: 8,
          retrievedContentsIncludeSubstrings: ['payment_intent.payment_failed'],
          responseMatchesRegex: ['https://example\\.com/lore/stripe/payment-failed'],
        },
      },
    ],
  },
  {
    id: 'generic-stripe-webhook-url-needs-event-clarification',
    topic: 'technical-reference-retrieval',
    title: 'Generic Stripe webhook request asks which Stripe event',
    suites: ['full'],
    seedDocuments: technicalReferenceSeedDocuments,
    steps: [
      {
        userInput: 'Show me the Stripe webhook URL.',
        expect: {
          requiresClarification: true,
          minRetrievedCount: 2,
          maxRetrievedCount: 10,
          retrievedContentsIncludeSubstrings: [
            'checkout.session.completed',
            'payment_intent.payment_failed',
          ],
          responseJudge: 'The assistant should say that there are multiple Stripe webhook URLs saved and ask which Stripe event the user wants instead of picking one arbitrarily.',
        },
      },
    ],
  },
  {
    id: 'cross-provider-webhook-request-needs-provider-clarification',
    topic: 'technical-reference-retrieval',
    title: 'Payment webhook request asks which provider when Stripe and Adyen exist',
    suites: ['full'],
    seedDocuments: technicalReferenceSeedDocuments,
    steps: [
      {
        userInput: 'Show me the payment webhook URL.',
        expect: {
          requiresClarification: true,
          minRetrievedCount: 2,
          maxRetrievedCount: 12,
          retrievedContentsIncludeSubstrings: ['Stripe', 'Adyen'],
          responseJudge: 'The assistant should explain that there are multiple saved payment webhook URLs across providers and ask whether the user means Stripe or Adyen, or ask for the specific event.',
        },
      },
    ],
  },
  {
    id: 'adyen-authorisation-webhook-by-notification-phrasing',
    topic: 'technical-reference-retrieval',
    title: 'Adyen AUTHORISATION webhook can be found from notification phrasing',
    suites: ['smoke', 'full', 'crucial'],
    seedDocuments: technicalReferenceSeedDocuments,
    steps: [
      {
        userInput: 'Which Adyen notification endpoint did I save for AUTHORISATION events?',
        expect: {
          minRetrievedCount: 1,
          maxRetrievedCount: 8,
          retrievedContentsIncludeSubstrings: ['Adyen payment AUTHORISATION notification webhook URL'],
          responseMatchesRegex: ['https://example\\.com/lore/adyen/authorisation'],
        },
      },
    ],
  },
]
