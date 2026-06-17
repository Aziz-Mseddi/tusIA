import { useEffect, useRef } from 'react'

interface Dot {
  x: number
  y: number
  p: number
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

const GAP = 26
const RADIUS = 0.9
const SPOTLIGHT_RADIUS = 220

/**
 * TunisIA engraving dot-grid background, rendered to a fixed full-screen
 * canvas. A faint field of bone dots twinkles slowly; a brass cursor
 * spotlight locally illuminates nearby dots — the "ledger paper" surface
 * of the engraved-instrument vibe.
 */
export function NeuralBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduced = prefersReducedMotion()
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    let w = 0
    let h = 0
    let raf = 0
    let dots: Dot[] = []
    const mouse = { x: -9999, y: -9999 }

    const resize = () => {
      w = window.innerWidth
      h = window.innerHeight
      canvas.style.width = w + 'px'
      canvas.style.height = h + 'px'
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      dots = []
      for (let y = GAP / 2; y < h; y += GAP) {
        for (let x = GAP / 2; x < w; x += GAP) {
          dots.push({ x, y, p: Math.random() * Math.PI * 2 })
        }
      }
      draw(performance.now())
    }

    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h)
      for (const d of dots) {
        const dx = d.x - mouse.x
        const dy = d.y - mouse.y
        const dist = Math.hypot(dx, dy)
        const spot = Math.max(0, 1 - dist / SPOTLIGHT_RADIUS)
        const twinkle = reduced ? 0 : (Math.sin(t / 2600 + d.p) + 1) * 0.5 * 0.045
        const base = 0.055 + twinkle
        if (spot > 0.01) {
          ctx.fillStyle = `rgba(196,165,114,${(base + spot * 0.5).toFixed(3)})`
        } else {
          ctx.fillStyle = `rgba(236,231,219,${base.toFixed(3)})`
        }
        ctx.fillRect(d.x - RADIUS, d.y - RADIUS, RADIUS * 2, RADIUS * 2)
      }
      if (!reduced) raf = requestAnimationFrame(draw)
    }

    const onMove = (e: MouseEvent) => {
      mouse.x = e.clientX
      mouse.y = e.clientY
    }
    const onLeave = () => {
      mouse.x = -9999
      mouse.y = -9999
    }

    resize()
    window.addEventListener('resize', resize)
    if (!reduced) {
      window.addEventListener('pointermove', onMove, { passive: true })
      window.addEventListener('pointerleave', onLeave)
    }

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerleave', onLeave)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 0,
        opacity: 0.92,
      }}
    />
  )
}
