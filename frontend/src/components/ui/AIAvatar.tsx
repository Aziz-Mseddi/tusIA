import { Bot } from 'lucide-react'
import { clsx } from 'clsx'
import { useEffect, useState } from 'react'

interface AIAvatarProps {
  /** Outer diameter in px */
  size?: number
  /** Speeds up + intensifies the orb while the assistant is responding */
  thinking?: boolean
  /**
   * Calm mode: drop the pinging rings so the orb stays quiet.
   * Used for inline message avatars to avoid a busy thread. Defaults to false.
   */
  calm?: boolean
  className?: string
}

/**
 * Animated AI assistant orb — flowing gold light inside a glowing core,
 * a sweeping ring, and a breathing halo.
 * Idle: slow, calm motion. Thinking: faster sweep, rotating light rays
 * and two orbiting particles.
 */
export function AIAvatar({ size = 36, thinking = false, calm = false, className }: AIAvatarProps) {
  const icon = Math.round(size * 0.46)
  const lively = !calm || thinking
  return (
    <span
      className={clsx('ai-orb', thinking && 'is-thinking', calm && !thinking && 'is-calm', className)}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <span className="ai-orb-halo" />
      {lively && <span className="ai-orb-ring r1" />}
      {lively && <span className="ai-orb-ring r2" />}
      {thinking && (
        <>
          <span className="ai-orb-rays" />
          <span className="ai-orb-orbit o1"><span className="ai-orb-particle" /></span>
          <span className="ai-orb-orbit o2"><span className="ai-orb-particle" /></span>
        </>
      )}
      <span className="ai-orb-sweep" />
      <span className="ai-orb-core">
        <span className="ai-orb-flow" />
        <Bot size={icon} className="text-gold ai-orb-icon" strokeWidth={1.6} />
      </span>
    </span>
  )
}

const THINKING_PHASES = [
  'Parsing your question',
  'Scanning market data',
  'Cross-referencing benchmarks',
  'Composing response',
]

interface ThinkingDotsProps {
  /** Short provider tag shown after the phase text, e.g. "OpenRouter" */
  label?: string
  /** Override the cycling status phrases */
  phases?: string[]
  className?: string
}

/**
 * "Waiting for a reply" status — a pulsing gold equalizer plus a cycling,
 * shimmering phase label ("Parsing your question… → Scanning market data…").
 * Keeps the old ThinkingDots name/props so existing call sites still work.
 */
export function ThinkingDots({ label, phases = THINKING_PHASES, className }: ThinkingDotsProps) {
  const [phase, setPhase] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setPhase((p) => p + 1), 1100)
    return () => clearInterval(id)
  }, [])
  return (
    <span className={clsx('thinking-wrap', className)} role="status" aria-live="polite">
      <span className="thinking-eq">
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className="thinking-bar"
            style={{ animationDuration: `${0.85 + i * 0.09}s`, animationDelay: `${i * 0.13}s` }}
          />
        ))}
      </span>
      <span key={phase} className="thinking-phase">
        {phases[phase % phases.length]}…
      </span>
      {label && <span className="thinking-tag">{label}</span>}
    </span>
  )
}
