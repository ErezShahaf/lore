/**
 * Explicit prompt layers for the agent (shared by classifier path and tool loop).
 * Keeps section order stable for debugging and traces.
 */

export interface LayeredPromptSections {
  readonly protocol: string
  readonly workerInstructions: string
  readonly routerClassificationJson: string
  readonly userInstructionsBlock: string
}

export function buildLayeredWorkerSystemPrompt(sections: LayeredPromptSections): string {
  const parts: string[] = [sections.protocol.trim(), sections.workerInstructions.trim()]

  if (sections.routerClassificationJson.trim().length > 0) {
    parts.push(sections.routerClassificationJson.trim())
  }

  if (sections.userInstructionsBlock.trim().length > 0) {
    parts.push(sections.userInstructionsBlock.trim())
  }

  return parts.filter((part) => part.length > 0).join('\n\n')
}
