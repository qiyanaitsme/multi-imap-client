import { useCallback, useEffect, useRef, useState } from 'react'

interface VirtualListOptions {
  /** Total number of items in the list */
  itemCount: number
  /** Fixed height (px) of a single row */
  itemHeight: number
  /** Extra rows rendered above/below the viewport to avoid flicker on fast scroll */
  overscan?: number
}

interface VirtualListResult {
  /** Ref to attach to the scrollable container */
  containerRef: React.RefObject<HTMLDivElement | null>
  /** Total scrollable height (px) — spacer that gives the scrollbar its size */
  totalHeight: number
  /** Index of the first item to render */
  startIndex: number
  /** Index (exclusive) of the last item to render */
  endIndex: number
  /** Pixel offset to translate the rendered window into place */
  offsetY: number
}

/**
 * Minimal fixed-height list virtualization — renders only the rows visible in
 * the viewport (plus overscan) instead of the whole list. Keeps the DOM small
 * for large folders (hundreds/thousands of messages) without extra deps.
 */
export function useVirtualList({
  itemCount,
  itemHeight,
  overscan = 6,
}: VirtualListOptions): VirtualListResult {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)

  const measure = useCallback(() => {
    if (containerRef.current) {
      setViewportHeight(containerRef.current.clientHeight)
    }
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    measure()

    const onScroll = (): void => setScrollTop(el.scrollTop)
    el.addEventListener('scroll', onScroll, { passive: true })

    // Track container resize (panel drag, window resize) to recompute the window.
    const ro = new ResizeObserver(measure)
    ro.observe(el)

    return () => {
      el.removeEventListener('scroll', onScroll)
      ro.disconnect()
    }
  }, [measure])

  // Reset scroll position when the list identity changes (e.g. new folder/account)
  // is the caller's responsibility via container scrollTop; here we just derive.
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan)
  const visibleCount = Math.ceil(viewportHeight / itemHeight) + overscan * 2
  const endIndex = Math.min(itemCount, startIndex + visibleCount)

  return {
    containerRef,
    totalHeight: itemCount * itemHeight,
    startIndex,
    endIndex,
    offsetY: startIndex * itemHeight,
  }
}
