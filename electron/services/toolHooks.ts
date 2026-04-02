import { logger } from '../logger'
import { executeOrchestratorTool, type OrchestratorToolContext } from './orchestratorTools'
import type { ToolExecutionResult } from './toolRegistry'

const MUTATING_TOOL_NAMES = new Set<string>(['save_documents', 'modify_documents'])

/**
 * Single interception point for tool execution (logging; future: policy gates).
 */
export async function executeOrchestratorToolWithHooks(
  toolName: string,
  toolArguments: Record<string, unknown>,
  context: OrchestratorToolContext,
): Promise<ToolExecutionResult> {
  if (MUTATING_TOOL_NAMES.has(toolName)) {
    logger.debug(
      { toolName, argumentKeys: Object.keys(toolArguments) },
      '[ToolHooks] PreToolUse mutating tool',
    )
  }

  const result = await executeOrchestratorTool(toolName, toolArguments, context)

  if (MUTATING_TOOL_NAMES.has(toolName)) {
    logger.debug(
      { toolName, outputPreview: result.output.slice(0, 240) },
      '[ToolHooks] PostToolUse mutating tool',
    )
  }

  return result
}
