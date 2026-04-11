import { ambiguousReferenceScenarios } from './ambiguousReferenceScenarios.mjs'
import { intentHeuristicTrapScenarios } from './intentHeuristicTrapScenarios.mjs'
import { conversationRobustnessScenarios } from './conversationRobustnessScenarios.mjs'
import { instructionPersistenceScenarios } from './instructionPersistenceScenarios.mjs'
import { largeCorpusRetrievalScenarios } from './largeCorpusRetrievalScenarios.mjs'
import { memoryRetrievalScenarios } from './memoryRetrievalScenarios.mjs'
import { newChatTodoScenarios } from './newChatTodoScenarios.mjs'
import { safetyBoundaryScenarios } from './safetyBoundaryScenarios.mjs'
import { structuredDataScenarios } from './structuredDataScenarios.mjs'
import { technicalReferenceRetrievalScenarios } from './technicalReferenceRetrievalScenarios.mjs'
import { todoCreationScenarios } from './todoCreationScenarios.mjs'
import { todoDeleteScenarios } from './todoDeleteScenarios.mjs'
import { todoRetrievalScenarios } from './todoRetrievalScenarios.mjs'
import { todoUpdateScenarios } from './todoUpdateScenarios.mjs'

export const scenarios = [
  ...ambiguousReferenceScenarios,
  ...intentHeuristicTrapScenarios,
  ...todoCreationScenarios,
  ...conversationRobustnessScenarios,
  ...structuredDataScenarios,
  ...technicalReferenceRetrievalScenarios,
  ...todoRetrievalScenarios,
  ...instructionPersistenceScenarios,
  ...memoryRetrievalScenarios,
  ...newChatTodoScenarios,
  ...largeCorpusRetrievalScenarios,
  ...todoUpdateScenarios,
  ...todoDeleteScenarios,
  ...safetyBoundaryScenarios,
]

export const scenarioTopics = [...new Set(scenarios.map((scenario) => scenario.topic))].sort()

export function getScenarioById(scenarioId) {
  return scenarios.find((scenario) => scenario.id === scenarioId) || null
}

export function getScenariosByTopic(topicId) {
  return scenarios.filter((scenario) => scenario.topic === topicId)
}
