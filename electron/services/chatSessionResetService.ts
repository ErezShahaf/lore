import { clearConversation } from './agentService'
import { abortAllInFlightChatRequests } from './ollamaService'

/**
 * Main-process chat hide path: stop Ollama completion traffic and clear agent session state
 * before the renderer receives `chat:reset`. Does not clear skill cache or UI status phrase LRU.
 */
export function resetChatSessionBeforeHidingWindow(): void {
  abortAllInFlightChatRequests()
  clearConversation()
}
