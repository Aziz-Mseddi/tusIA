import { useEffect, useRef } from 'react'

/**
 * Premium cursor layer: a soft brass spotlight that lags behind the pointer,
 * a thin tracking ring that expands over interactive targets, and a click
 * ripple. Disabled on touch / coarse pointers and for reduced-motion users.
 * Purely decorative — never intercepts pointer events.
 */
export function CursorGlow() {
  const glowRef = useRef<HTMLDivElement>(null)
  const ringRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const fine = window.matchMedia?.('(pointer: fine)').matches
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (!fine || reduced) return

    const glow = glowRef.current
    const ring = ringRef.current
    if (!glow || !ring) return

    let mx = window.innerWidth / 2
    let my = window.innerHeight / 2
    let gx = mx
    let gy = my
    let rx = mx
    let ry = my
    let hovering = false
    let raf = 0

    const INTERACTIVE = 'a,button,[role="button"],input,textarea,select,label,.cursor-target'

    const onMove = (e: MouseEvent) => {
      mx = e.clientX
      my = e.clientY
      const el = e.target as HTMLElement | null
      hovering = !!el?.closest?.(INTERACTIVE)
    }

    const spawnRipple = (x: number, y: number) => {
      const r = document.createElement('div')
      r.className = 'cursor-ripple'
      r.style.left = x + 'px'
      r.style.top = y + 'px'
      document.body.appendChild(r)
      window.setTimeout(() => r.remove(), 650)
    }
    const onDown = (e: MouseEvent) => spawnRipple(e.clientX, e.clientY)

    const loop = () => {
      gx += (mx - gx) * 0.12
      gy += (my - gy) * 0.12
      rx += (mx - rx) * 0.24
      ry += (my - ry) * 0.24

      glow.style.transform = `translate3d(${gx - 160}px, ${gy - 160}px, 0)`

      const s = hovering ? 1.9 : 1
      ring.style.transform = `translate3d(${rx - 13}px, ${ry - 13}px, 0) scale(${s})`
      ring.style.opacity = hovering ? '0.95' : '0.5'
      ring.style.borderColor = hovering
        ? 'rgba(196,165,114,0.9)'
        : 'rgba(196,165,114,0.4)'

      raf = requestAnimationFrame(loop)
    }

    window.addEventListener('mousemove', onMove, { passive: true })
    window.addEventListener('mousedown', onDown)
    loop()

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mousedown', onDown)
    }
  }, [])

  return (
    <>
      <div ref={glowRef} className="cursor-glow" aria-hidden />
      <div ref={ringRef} className="cursor-ring" aria-hidden />
    </>
  )
}
