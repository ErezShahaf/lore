import type { MutablePipelineTraceSink, PipelineStageRecord } from '../../shared/types'

const VERBOSE_PIPELINE_TRACE_ENV = 'LORE_VERBOSE_PIPELINE_TRACE'
const EVAL_SERVER_ENABLE_ENV = 'LORE_ENABLE_EVAL_SERVER'

const PIPELINE_SUB_AGENT_TEXT_PREVIEW_MAX_CHARS = 600

export function isVerboseSubAgentPipelineTraceEnabled(): boolean {
  if (process.env[VERBOSE_PIPELINE_TRACE_ENV] === '0') {
    return false
  }
  if (process.env[VERBOSE_PIPELINE_TRACE_ENV] === '1') {
    return true
  }
  return process.env[EVAL_SERVER_ENABLE_ENV] === '1'
}

export function truncateForSubAgentPipelineTrace(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text
  }
  return `${text.slice(0, Math.max(0, maxChars - 3))}...`
}

export function truncateForSubAgentPipelineTraceDefault(text: string): string {
  return truncateForSubAgentPipelineTrace(text, PIPELINE_SUB_AGENT_TEXT_PREVIEW_MAX_CHARS)
}

/**
 * Records an extra pipeline stage when verbose tracing is on (eval server or LORE_VERBOSE_PIPELINE_TRACE=1).
 * Does nothing in normal packaged chat — avoids extra allocations and trace size.
 * `ordinal` / `timestamp` on `record` are overwritten so callers may pass placeholders.
 */
export function appendVerbosePipelineStageRecord(
  sink: MutablePipelineTraceSink | null | undefined,
  record: PipelineStageRecord,
): void {
  if (!sink || !isVerboseSubAgentPipelineTraceEnabled()) {
    return
  }
  const ordinal = sink.stages.length
  sink.stages.push({
    ...record,
    ordinal,
    timestamp: record.timestamp ?? new Date().toISOString(),
  } as PipelineStageRecord)
}
