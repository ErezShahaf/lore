const stripeCheckoutSessionCompletedJson = '{"provider":"stripe","event":"checkout.session.completed","url":"https://example.com/lore/stripe/checkout-session-completed"}'
const stripePaymentFailedJson = '{"provider":"stripe","event":"payment_intent.payment_failed","url":"https://example.com/lore/stripe/payment-failed"}'
const stripeSubscriptionUpdatedJson = '{"provider":"stripe","event":"customer.subscription.updated","url":"https://example.com/lore/stripe/subscription-updated"}'
const adyenAuthorisationJson = '{"provider":"adyen","eventCode":"AUTHORISATION","url":"https://example.com/lore/adyen/authorisation"}'

export const structuredDataScenarios = [
  {
    id: 'instruction-plus-json-saves-on-first-turn',
    topic: 'structured-data',
    title: 'Explicit save instruction with JSON saves immediately without clarification',
    suites: ['full'],
    steps: [
      {
        userInput:
          'save this webhook payload of order delivered event in food delivery api\n\n{"event":"order.delivered","order_id":"ord_9f3a7c21","status":"delivered"}',
        expect: {
          storedCount: 1,
          responseJudge: 'The assistant should confirm it saved the content. It must not ask what to do with the JSON or clarify—the user already said to save it.',
          dataJudge: 'The database must contain exactly one document. The stored content should be the JSON payload (or the payload with minimal surrounding context from the instruction). It must not be a clarification message or meta-instructions.',
        },
      },
    ],
  },
  {
    id: 'raw-json-without-instruction-needs-clarification',
    topic: 'structured-data',
    title: 'Raw JSON alone asks what to do before mutating state',
    suites: ['smoke', 'full'],
    steps: [
      {
        userInput: stripeCheckoutSessionCompletedJson,
        expect: {
          responseJudge: 'The assistant should recognize that the user sent raw structured data without an explicit action. It should ask whether the user wants to save it, explain it, or retrieve something about it, and it should not claim that it already stored or changed any data.',
          dataJudge: 'The database should still be empty after this step because the user did not explicitly ask to store anything yet.',
        },
      },
    ],
  },
  {
    id: 'raw-json-then-store-it-saves-json-not-other-content',
    topic: 'structured-data',
    title: 'Brief "store it" after JSON clarification saves the JSON not other content',
    suites: ['full'],
    steps: [
      {
        userInput: '{"event":"order.delivered","order_id":"ord_123","status":"delivered"}',
        expect: {
          responseJudge: 'The assistant should ask what the user wants to do with the structured data (save, retrieve, etc.) and should not store it yet.',
          dataJudge: 'The database should remain empty after this step.',
        },
      },
      {
        userInput: 'store it',
        expect: {
          responseJudge: 'The assistant should suggest adding a short description for easier retrieval, or ask if the user wants to add one. It should not have saved yet.',
          dataJudge: 'The database should still be empty. The user said "store it" but the assistant may first suggest adding a description.',
        },
      },
      {
        userInput: 'just save',
        expect: {
          storedCount: 1,
          responseJudge: 'The assistant should confirm it saved the previously provided JSON. It must not mention saving something unrelated such as a shape plan, strategy note, or internal agent output.',
          dataJudge: 'The database must contain exactly one document whose content is the JSON the user pasted in the first turn (with event order.delivered, order_id ord_123, status delivered). The stored content must not be text from a shape plan, notes for decomposer, or assistant messages.',
        },
      },
    ],
  },
  {
    id: 'raw-json-clarification-then-save-and-retrieve-exactly',
    topic: 'structured-data',
    title: 'Clarified raw JSON can be saved and retrieved verbatim',
    suites: ['full'],
    steps: [
      {
        userInput: stripeCheckoutSessionCompletedJson,
        expect: {
          responseJudge: 'The assistant should ask a clarification question about what to do with this raw JSON and should not store it yet.',
          dataJudge: 'The database should remain empty after this step.',
        },
      },
      {
        userInput: 'Save that JSON exactly as a note.',
        expect: {
          storedCount: 1,
          responseJudge: 'The assistant should confirm that it saved the previously provided JSON exactly as requested.',
          dataJudge:
            'The database should now contain exactly one stored document. Its content must be exactly the same JSON string the user pasted in the immediately previous turn (the minimal object with provider stripe, event checkout.session.completed, and the example url field). Accept that literal payload as correct; do not require a fuller production Stripe webhook shape.',
        },
      },
      {
        userInput: 'Show me the exact Stripe checkout.session.completed webhook JSON I saved.',
        expect: {
          minRetrievedCount: 1,
          maxRetrievedCount: 4,
          responseCodeBlockJsonIncludesFields: {
            provider: 'stripe',
            event: 'checkout.session.completed',
            url: 'https://example.com/lore/stripe/checkout-session-completed',
          },
        },
      },
    ],
  },
  {
    id: 'specific-structured-json-request-picks-the-right-stripe-event',
    topic: 'structured-data',
    title: 'Specific JSON retrieval can pick the right Stripe event among several',
    suites: ['smoke', 'full'],
    seedDocuments: [
      {
        content: stripeCheckoutSessionCompletedJson,
        type: 'note',
        tags: ['stripe', 'webhook', 'checkout.session.completed'],
        source: 'eval-seed',
      },
      {
        content: stripePaymentFailedJson,
        type: 'note',
        tags: ['stripe', 'webhook', 'payment_intent.payment_failed'],
        source: 'eval-seed',
      },
      {
        content: stripeSubscriptionUpdatedJson,
        type: 'note',
        tags: ['stripe', 'webhook', 'customer.subscription.updated'],
        source: 'eval-seed',
      },
    ],
    steps: [
      {
        userInput: 'Show me the Stripe webhook JSON for checkout.session.completed.',
        expect: {
          minRetrievedCount: 1,
          maxRetrievedCount: 4,
          retrievedContentsIncludeSubstrings: ['checkout.session.completed'],
          retrievedContentsExcludeSubstrings: ['payment_intent.payment_failed'],
          responseCodeBlockJsonIncludesFields: {
            provider: 'stripe',
            event: 'checkout.session.completed',
            url: 'https://example.com/lore/stripe/checkout-session-completed',
          },
        },
      },
    ],
  },
  {
    id: 'generic-stripe-json-request-needs-event-clarification',
    topic: 'structured-data',
    title: 'Generic Stripe JSON request asks which Stripe webhook event',
    suites: ['full'],
    seedDocuments: [
      {
        content: stripeCheckoutSessionCompletedJson,
        type: 'note',
        tags: ['stripe', 'webhook', 'checkout.session.completed'],
        source: 'eval-seed',
      },
      {
        content: stripePaymentFailedJson,
        type: 'note',
        tags: ['stripe', 'webhook', 'payment_intent.payment_failed'],
        source: 'eval-seed',
      },
      {
        content: stripeSubscriptionUpdatedJson,
        type: 'note',
        tags: ['stripe', 'webhook', 'customer.subscription.updated'],
        source: 'eval-seed',
      },
    ],
    steps: [
      {
        userInput: 'Show me the Stripe webhook JSON.',
        expect: {
          requiresClarification: true,
          minRetrievedCount: 2,
          maxRetrievedCount: 8,
          retrievedContentsIncludeSubstrings: [
            'checkout.session.completed',
            'payment_intent.payment_failed',
          ],
          responseJudge: 'The assistant should explain that there are multiple Stripe webhook JSON payloads and ask which event the user wants instead of returning an arbitrary one.',
        },
      },
    ],
  },
  {
    id: 'malformed-json-does-not-get-saved-implicitly',
    topic: 'structured-data',
    title: 'Malformed JSON stays a clarification case instead of implicit storage',
    suites: ['full'],
    steps: [
      {
        userInput: '{"provider":"stripe","event":"checkout.session.completed","url":"https://example.com/lore/stripe/checkout-session-completed"',
        expect: {
          responseJudge: 'The assistant should recognize that the message looks like incomplete or malformed structured data and ask what the user wants to do with it, rather than pretending it is valid, storing it, or inventing missing content.',
          dataJudge: 'The database should remain empty after this step because the user never made an explicit storage request.',
        },
      },
    ],
  },
  {
    id: 'specific-adyen-json-request-returns-exact-payload',
    topic: 'structured-data',
    title: 'Specific Adyen JSON retrieval returns the exact stored payload',
    suites: ['full'],
    seedDocuments: [
      {
        content: adyenAuthorisationJson,
        type: 'note',
        tags: ['adyen', 'webhook', 'authorisation'],
        source: 'eval-seed',
      },
      {
        content: stripePaymentFailedJson,
        type: 'note',
        tags: ['stripe', 'webhook', 'payment_intent.payment_failed'],
        source: 'eval-seed',
      },
    ],
    steps: [
      {
        userInput: 'Show me the Adyen AUTHORISATION webhook JSON.',
        expect: {
          minRetrievedCount: 1,
          maxRetrievedCount: 4,
          responseCodeBlockJsonIncludesFields: {
            provider: 'adyen',
            eventCode: 'AUTHORISATION',
            url: 'https://example.com/lore/adyen/authorisation',
          },
        },
      },
    ],
  },
]
