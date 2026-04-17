import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

interface ThinkingStreamProps {
  readonly text: string
  /**
   * Shown before the first status or model trace arrives so the strip is present for the whole turn.
   */
  readonly isAwaitingFirstPipelineTrace?: boolean
}

const VIEWPORT_MASK =
  'linear-gradient(to bottom, transparent 0%, black 14%, black 86%, transparent 100%)'

/** Total strip height when mounted (label + fixed viewport + padding); keep in sync with layout reserve. */
const STRIP_OUTER_HEIGHT_CLASS = 'h-[4.25rem]'
const STRIP_VIEWPORT_HEIGHT_CLASS = 'h-9 min-h-9 max-h-9'

const EXIT_ANIMATION_MS = 200

export function ThinkingStream({
  text,
  isAwaitingFirstPipelineTrace = false,
}: ThinkingStreamProps) {
  const scrollContainerReference = useRef<HTMLDivElement>(null)
  const lastNonEmptyDisplayReference = useRef('')

  const displayText =
    text.length > 0 ? text : isAwaitingFirstPipelineTrace ? 'Working…' : ''

  const wantsPanelVisible = displayText.length > 0
  const [showPanelDom, setShowPanelDom] = useState(false)
  const [isExitAnimation, setIsExitAnimation] = useState(false)

  const renderedText = wantsPanelVisible
    ? displayText
    : lastNonEmptyDisplayReference.current

  useEffect(() => {
    if (wantsPanelVisible) {
      setIsExitAnimation(false)
      setShowPanelDom(true)
      return
    }
    if (!showPanelDom) {
      return
    }
    setIsExitAnimation(true)
    const timeoutId = window.setTimeout(() => {
      setShowPanelDom(false)
      setIsExitAnimation(false)
    }, EXIT_ANIMATION_MS)
    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [wantsPanelVisible, showPanelDom])

  useLayoutEffect(() => {
    if (displayText.length > 0) {
      lastNonEmptyDisplayReference.current = displayText
    }
  }, [displayText])

  useLayoutEffect(() => {
    const element = scrollContainerReference.current
    if (!element) return
    element.scrollTop = element.scrollHeight
  }, [renderedText, showPanelDom])

  if (!showPanelDom) {
    return null
  }

  return (
    <div
      className={cn(
        'shrink-0 border-t border-border/15 bg-[#0e0e0e]/95 px-6 pb-1.5 pt-1',
        STRIP_OUTER_HEIGHT_CLASS,
        'flex flex-col',
        isExitAnimation ? 'animate-thinking-strip-out' : 'animate-thinking-strip-in',
      )}
    >
      <p className="mb-0.5 shrink-0 text-[10px] font-medium tracking-wide text-muted-foreground/90">
        Thinking
      </p>
      <div
        className={cn('relative overflow-hidden rounded-sm', STRIP_VIEWPORT_HEIGHT_CLASS)}
        style={{
          WebkitMaskImage: VIEWPORT_MASK,
          maskImage: VIEWPORT_MASK,
        }}
      >
        <div
          ref={scrollContainerReference}
          className={cn(
            STRIP_VIEWPORT_HEIGHT_CLASS,
            'overflow-y-auto overflow-x-hidden text-[11px] leading-snug text-muted-foreground/65 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden',
          )}
        >
          <div
            className={
              text.length === 0 && wantsPanelVisible
                ? 'whitespace-pre-wrap break-words italic text-muted-foreground/50'
                : 'whitespace-pre-wrap break-words'
            }
          >
            {renderedText}
          </div>
        </div>
      </div>
    </div>
  )
}
