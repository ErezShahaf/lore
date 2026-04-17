import { useEffect, useRef } from 'react'

import {
  CHAT_WINDOW_MIN_HEIGHT,
  CHAT_WINDOW_MAX_HEIGHT,
} from '../../shared/chatWindowConstants'

const INPUT_BAR_HEIGHT = 152
const PADDING = 16
const WRAPPER_PADDING = 24

export interface UseWindowResizeOptions {
  /**
   * Extra height (px) laid out below the observed container but not included in its `scrollHeight`
   * — for example the thinking strip — so the host window is not undersized when that UI appears.
   */
  readonly extraBottomContentHeightPx?: number
}

export function useWindowResize(
  containerRef: React.RefObject<HTMLDivElement | null>,
  options?: UseWindowResizeOptions,
) {
  const lastHeight = useRef(CHAT_WINDOW_MIN_HEIGHT)
  const extraBottomContentHeightPx = options?.extraBottomContentHeightPx ?? 0

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const applyResize = (): void => {
      const contentHeight = el.scrollHeight + extraBottomContentHeightPx
      const desired = Math.min(
        contentHeight + INPUT_BAR_HEIGHT + PADDING + WRAPPER_PADDING * 2,
        CHAT_WINDOW_MAX_HEIGHT,
      )
      const clamped = Math.max(CHAT_WINDOW_MIN_HEIGHT, desired)

      if (clamped !== lastHeight.current) {
        lastHeight.current = clamped
        window.loreAPI.resizeChatWindow(clamped)
      }
    }

    const observer = new ResizeObserver(applyResize)

    observer.observe(el)
    applyResize()
    return () => observer.disconnect()
  }, [containerRef, extraBottomContentHeightPx])
}
