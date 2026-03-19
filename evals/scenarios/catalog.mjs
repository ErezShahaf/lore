import { conversationRobustnessScenarios } from './conversationRobustnessScenarios.mjs'
import { memoryRetrievalScenarios } from './memoryRetrievalScenarios.mjs'
import { safetyBoundaryScenarios } from './safetyBoundaryScenarios.mjs'
import { todoCreationScenarios } from './todoCreationScenarios.mjs'
import { todoDeleteScenarios } from './todoDeleteScenarios.mjs'
import { todoRetrievalScenarios } from './todoRetrievalScenarios.mjs'
import { todoUpdateScenarios } from './todoUpdateScenarios.mjs'

export const scenarios = [
  ...todoCreationScenarios,
  ...conversationRobustnessScenarios,
  ...todoRetrievalScenarios,
  ...memoryRetrievalScenarios,
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
