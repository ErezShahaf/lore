import { useEffect, useRef } from 'react'

const INPUT_BAR_HEIGHT = 80
const MAX_WINDOW_HEIGHT = 400
const MIN_WINDOW_HEIGHT = 80
const PADDING = 16
const WRAPPER_PADDING = 24

export function useWindowResize(containerRef: React.RefObject<HTMLDivElement | null>) {
  const lastHeight = useRef(MIN_WINDOW_HEIGHT)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const observer = new ResizeObserver(() => {
      const contentHeight = el.scrollHeight
      const desired = Math.min(
        contentHeight + INPUT_BAR_HEIGHT + PADDING + WRAPPER_PADDING * 2,
        MAX_WINDOW_HEIGHT,
      )
      const clamped = Math.max(MIN_WINDOW_HEIGHT, desired)

      if (clamped !== lastHeight.current) {
        lastHeight.current = clamped
        window.loreAPI.resizeChatWindow(clamped)
      }
    })

    observer.observe(el)
    return () => observer.disconnect()
  }, [containerRef])
}
