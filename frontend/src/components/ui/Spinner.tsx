import { clsx } from 'clsx'

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizes = { sm: 'h-4 w-4', md: 'h-5 w-5', lg: 'h-9 w-9' }

/** Gold dual-ring spinner. CSS-driven; honours the existing size/className API. */
export function Spinner({ size = 'md', className }: SpinnerProps) {
  return (
    <span
      className={clsx('spinner-ring', sizes[size], className)}
      role="status"
      aria-label="Loading"
    />
  )
}

/** Branded full-page loader: three gold dots orbiting a soft core. */
export function FullPageSpinner() {
  return (
    <div className="flex flex-col items-center justify-center py-32 gap-6">
      <div className="loader-orbit" role="status" aria-label="Loading">
        <span className="loader-core" />
        {[0, 120, 240].map((deg) => (
          <span key={deg} className="loader-arm" style={{ transform: `rotate(${deg}deg)` }}>
            <span className="loader-dot" style={{ animationDelay: `${(deg / 360) * 1.2}s` }} />
          </span>
        ))}
      </div>
      <span className="text-[10px] tracking-[0.32em] uppercase text-white/30 animate-pulse-slow">
        Loading
      </span>
    </div>
  )
}
