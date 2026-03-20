const HELP_QUERY_PATTERN = /\b(how do i|how can i|how does|what can you do|help|usage|capabilities?)\b/i
const TODO_PATTERN = /\b(todo|todos|to-do|to dos|to do|task list|tasks?)\b/i
const TODO_PLACEMENT_PATTERN = /\bput\b[\s\S]{0,160}\b(?:on|in)\s+(?:my\s+)?(?:todo(?:\s+list)?|task\s+list|tasks?|reminders?)\b/i
const RETRIEVAL_VERB_PATTERN = /\b(show|list|find|search|recall|remember|summarize|tell|get|what|which)\b/i
const DATA_REFERENCE_PATTERN = /\b(my|me|i|stored|saved|database|db|notes?|todos?|tasks?|documents?)\b/i
const DATE_REQUEST_PATTERN = /\b(date|day|time|when|today|yesterday|tomorrow|week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i
const TAG_REQUEST_PATTERN = /\b(tag|tags|label|labels|category|categories)\b/i
const EXPLICIT_STORAGE_VERB_PATTERN = /\b(save|store|remember|note|track|log|capture|add)\b/i
const REFERENTIAL_STORAGE_PATTERN = /\b(save|store|remember|note|track|log|capture|add)\s+(that|this|it|them|those|these|the last one|the first one|the second one|the previous one)\b/i
const EXPLICIT_LIST_PREFIX_PATTERN = /^\s*(?:add\s+to\s+(?:my\s+)?(todos?|todo\s+list|tasks?|notes?|ideas?|reminders?|meetings?)|(todos?|tasks?|notes?|ideas?|reminders?|meetings?))\s*:/i
const SHORT_REACTION_PATTERN = /^(ok|okay|k|thanks|thank you|cool|nice|great|sure|fine|whatever|yikes|lol|lmao|haha|wow|damn|ugh|oops|my bad|sounds good|got it|cry a river)[.!?]*$/i
const MODIFICATION_VERB_PATTERN = /\b(delete|remove|update|change|replace|clear|forget|edit|rename|move|reorder)\b/i
const COMPLETION_VERB_PATTERN = /\b(finished|finish|done|completed|complete)\b/i
const REFERENTIAL_TARGET_PATTERN = /\b(it|that|this|one|them|those|these)\b/i
const EXPLICIT_MULTI_TARGET_PATTERN = /\b(all|both|these|those|all of them|every|everything)\b/i
const ORDINAL_REFERENCE_PATTERN = /\b(first|second|third|last|previous)\b/i
const VAGUE_IMPERATIVE_PATTERN = /^(?:please\s+)?(?:do|handle|fix|solve|manage|deal with|take care of)\s+(?:it|this|that|the thing|the stuff|something)\b[.!?]*$/i
const CLARIFICATION_FOLLOW_UP_PATTERN = /^(?:i mean|the one|the .* one|the first|the second|the third|from [a-z]+|it'?s|its)\b/i
const QUESTION_REQUEST_PATTERN = /^(?:who|what|which|where|when)\b/i
const RAW_STRUCTURED_DATA_FENCE_PATTERN = /^```[\s\S]*```$/i
const SELF_REPORTED_COMPLETION_PATTERN = /\b(?:i(?:'ve| have)?\s+)?(?:already\s+)?(?:finished|done|completed)\b/i
const INSTRUCTION_PREFERENCE_PATTERN = /^\s*from now on\b/i

export function looksLikeTodoQuery(userInput: string): boolean {
  return TODO_PATTERN.test(userInput)
}

export function looksLikeExplicitStorageRequest(userInput: string): boolean {
  return EXPLICIT_STORAGE_VERB_PATTERN.test(userInput)
    || TODO_PLACEMENT_PATTERN.test(userInput)
    || looksLikeExplicitTypedList(userInput)
}

export function looksLikeExplicitTypedList(userInput: string): boolean {
  return EXPLICIT_LIST_PREFIX_PATTERN.test(userInput)
}

export function looksLikeExplicitModificationRequest(userInput: string): boolean {
  return MODIFICATION_VERB_PATTERN.test(userInput)
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

export function looksLikeQuestionRequest(userInput: string): boolean {
  const normalizedInput = userInput.trim()
  if (normalizedInput.length === 0 || HELP_QUERY_PATTERN.test(normalizedInput)) {
    return false
  }

  return QUESTION_REQUEST_PATTERN.test(normalizedInput) || /\?\s*$/.test(normalizedInput)
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

export function looksLikeBehaviorPreferenceInstruction(userInput: string): boolean {
  return INSTRUCTION_PREFERENCE_PATTERN.test(userInput.trim())
}

export function looksLikeReferentialCommandRequest(userInput: string): boolean {
  const hasCommandVerb = MODIFICATION_VERB_PATTERN.test(userInput) || COMPLETION_VERB_PATTERN.test(userInput)
  return hasCommandVerb && REFERENTIAL_TARGET_PATTERN.test(userInput)
}

export function looksLikeExplicitMultiTargetRequest(userInput: string): boolean {
  return EXPLICIT_MULTI_TARGET_PATTERN.test(userInput)
}

export function looksLikeOrdinalReference(userInput: string): boolean {
  return ORDINAL_REFERENCE_PATTERN.test(userInput)
}

export function looksLikeAmbiguousDocumentReference(userInput: string): boolean {
  if (!REFERENTIAL_TARGET_PATTERN.test(userInput)) {
    return false
  }

  const hasDisambiguatingLanguage = /\b(all|both|either|any|first|second|third|last|previous)\b/i.test(userInput)
  return !hasDisambiguatingLanguage
}

export function looksLikeVagueImperativeRequest(userInput: string): boolean {
  return VAGUE_IMPERATIVE_PATTERN.test(userInput.trim())
}

export function looksLikeClarificationFollowUp(userInput: string): boolean {
  const normalizedInput = userInput.trim()
  return CLARIFICATION_FOLLOW_UP_PATTERN.test(normalizedInput) || /^\d+\s*$/.test(normalizedInput)
}

export function looksLikeRawStructuredDataInput(userInput: string): boolean {
  const normalizedInput = userInput.trim()
  if (normalizedInput.length < 2) {
    return false
  }

  if (RAW_STRUCTURED_DATA_FENCE_PATTERN.test(normalizedInput)) {
    return true
  }

  if (normalizedInput.startsWith('{') && normalizedInput.includes(':')) {
    return true
  }

  if (normalizedInput.startsWith('[') && /[\]}\]]\s*$/.test(normalizedInput)) {
    return true
  }

  return false
}

export function looksLikeSelfReportedCompletion(userInput: string): boolean {
  const normalizedInput = userInput.trim()
  return SELF_REPORTED_COMPLETION_PATTERN.test(normalizedInput)
    && /\b(the|that|this|one|todo|task|ride)\b/i.test(normalizedInput)
}
