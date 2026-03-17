const HELP_QUERY_PATTERN = /\b(how do i|how can i|how does|what can you do|help|usage|capabilities?)\b/i
const TODO_PATTERN = /\b(todo|todos|to-do|to dos|to do|task list|tasks?)\b/i
const RETRIEVAL_VERB_PATTERN = /\b(show|list|find|search|recall|remember|summarize|tell|get|what|which)\b/i
const DATA_REFERENCE_PATTERN = /\b(my|me|i|stored|saved|database|db|notes?|todos?|tasks?|documents?)\b/i
const DATE_REQUEST_PATTERN = /\b(date|day|time|when|today|yesterday|tomorrow|week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i
const TAG_REQUEST_PATTERN = /\b(tag|tags|label|labels|category|categories)\b/i
const EXPLICIT_STORAGE_VERB_PATTERN = /\b(save|store|remember|note|track|log|capture|add)\b/i
const REFERENTIAL_STORAGE_PATTERN = /\b(save|store|remember|note|track|log|capture|add)\s+(that|this|it|them|those|these|the last one|the first one|the second one|the previous one)\b/i
const EXPLICIT_LIST_PREFIX_PATTERN = /^\s*(todos?|tasks?|notes?|ideas?|reminders?|meetings?)\s*:/i
const SHORT_REACTION_PATTERN = /^(ok|okay|k|thanks|thank you|cool|nice|great|sure|fine|whatever|yikes|lol|lmao|haha|wow|damn|ugh|oops|my bad|sounds good|got it|cry a river)[.!?]*$/i

export function looksLikeTodoQuery(userInput: string): boolean {
  return TODO_PATTERN.test(userInput)
}

export function looksLikeExplicitStorageRequest(userInput: string): boolean {
  return EXPLICIT_STORAGE_VERB_PATTERN.test(userInput) || looksLikeExplicitTypedList(userInput)
}

export function looksLikeExplicitTypedList(userInput: string): boolean {
  return EXPLICIT_LIST_PREFIX_PATTERN.test(userInput)
}

export function looksLikeReferentialStorageRequest(userInput: string): boolean {
  return REFERENTIAL_STORAGE_PATTERN.test(userInput)
}

export function looksLikeShortReaction(userInput: string): boolean {
  const normalizedInput = userInput.trim()
  if (normalizedInput.length === 0) {
    return false
  }

  const wordCount = normalizedInput.split(/\s+/).length
  return wordCount <= 5 && SHORT_REACTION_PATTERN.test(normalizedInput)
}

export function looksLikeStoredDataQuestion(userInput: string): boolean {
  if (HELP_QUERY_PATTERN.test(userInput)) {
    return false
  }

  const normalizedInput = userInput.trim().toLowerCase()
  if (normalizedInput.length === 0) {
    return false
  }

  const dataQuestionPatterns = [
    /\bwhat do you know about\b/i,
    /\bwhat did i (say|write|mention|store|save)\b/i,
    /\bshow me (my|the)\b/i,
    /\blist (my|the|all)\b/i,
    /\bfind (all|my|the)\b/i,
    /\bsearch (my|the)\b/i,
    /\brecall\b/i,
    /\bremember\b/i,
  ]

  if (dataQuestionPatterns.some((pattern) => pattern.test(normalizedInput))) {
    return true
  }

  if (looksLikeTodoQuery(normalizedInput) && RETRIEVAL_VERB_PATTERN.test(normalizedInput)) {
    return true
  }

  return RETRIEVAL_VERB_PATTERN.test(normalizedInput) && DATA_REFERENCE_PATTERN.test(normalizedInput)
}

export function userAskedForDateInformation(userInput: string): boolean {
  return DATE_REQUEST_PATTERN.test(userInput)
}

export function userAskedForTagInformation(userInput: string): boolean {
  return TAG_REQUEST_PATTERN.test(userInput)
}

export function looksLikeStructuralRetrievalQuery(userInput: string): boolean {
  const normalizedInput = userInput.trim().toLowerCase()
  if (normalizedInput.length === 0 || HELP_QUERY_PATTERN.test(normalizedInput)) {
    return false
  }

  const structuralPatterns = [
    /\bfind all\b/i,
    /\blist all\b/i,
    /\bshow (me )?(all|my)\b/i,
    /\bwhat did i (write|add|save|store)\b/i,
    /\bwhich (notes|todos|documents)\b/i,
  ]

  return structuralPatterns.some((pattern) => pattern.test(normalizedInput))
}

export function usesCreatedAtSemantics(userInput: string): boolean {
  return /\b(wrote|write|added|add|saved|save|stored|store|created|create|entered)\b/i.test(userInput)
}

export function looksLikeInstructionManagementRequest(userInput: string): boolean {
  const hasInstructionReference = /\b(instruction|instructions|preference|preferences|rule|rules|format|formatting|behavior)\b/i.test(userInput)
  const hasCommandVerb = /\b(delete|remove|clear|forget|replace|update|change|stop)\b/i.test(userInput)
  return hasInstructionReference && hasCommandVerb
}

export function looksLikeReferentialCommandRequest(userInput: string): boolean {
  const hasCommandVerb = /\b(delete|remove|update|change|replace|clear|forget)\b/i.test(userInput)
  const hasReference = /\b(it|that|this|one|them)\b/i.test(userInput)
  return hasCommandVerb && hasReference
}
