import { useEffect, useRef, useState } from 'react'
import { useIsFetching, useIsMutating } from '@tanstack/react-query'

/**
 * Thin gold indeterminate bar pinned to the very top of the viewport.
 * Lights up whenever any React Query request or mutation is in flight,
 * then glides out — the app's global "working" heartbeat.
 */
export function TopProgressBar() {
  const fetching = useIsFetching()
  const mutating = useIsMutating()
  const active = fetching + mutating > 0

  // Keep the bar visible briefly after activity ends so quick requests still register.
  const [visible, setVisible] = useState(false)
  const timer = useRef<number>()

  useEffect(() => {
    if (active) {
      window.clearTimeout(timer.current)
      setVisible(true)
    } else if (visible) {
      timer.current = window.setTimeout(() => setVisible(false), 380)
    }
    return () => window.clearTimeout(timer.current)
  }, [active, visible])

  return (
    <div className="top-progress" data-active={visible} aria-hidden>
      <div className="top-progress-bar" />
    </div>
  )
}
