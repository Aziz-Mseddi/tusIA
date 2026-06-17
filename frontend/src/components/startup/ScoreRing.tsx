interface ScoreRingProps {
  score: number
  size?: number
  strokeWidth?: number
  showLabel?: boolean
  grade?: string
}

function getColor(score: number): string {
  if (score >= 70) return '#8FA982'
  if (score >= 50) return '#C4A572'
  if (score >= 35) return '#C58A6B'
  return '#B36B4C'
}

export function ScoreRing({ score, size = 80, strokeWidth = 6, showLabel = true, grade }: ScoreRingProps) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (score / 100) * circumference
  const color = getColor(score)

  return (
    <div className="relative inline-flex items-center justify-center flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(236,231,219,0.06)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="butt"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.8s ease' }}
        />
      </svg>
      {showLabel && (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-light leading-none" style={{ fontSize: size * 0.24, color, fontFamily: 'var(--font-mono)' }}>
            {Math.round(score)}
          </span>
          {grade && (
            <span className="font-normal leading-none mt-0.5" style={{ fontSize: size * 0.16, color: 'rgba(236,231,219,0.35)', fontFamily: 'var(--font-mono)' }}>
              {grade}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

export function PillarBar({ label, value }: { label: string; value?: number | null }) {
  const pct = value != null ? (value / 10) * 100 : 0
  const color = pct >= 70 ? '#8FA982' : pct >= 50 ? '#C4A572' : '#C58A6B'

  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs font-light">
        <span className="text-white/40 capitalize tracking-wide">{label}</span>
        <span style={{ color }}>{value != null ? value.toFixed(1) : '-'}</span>
      </div>
      <div className="h-px bg-white/[0.06] relative overflow-visible">
        <div
          className="absolute top-0 left-0 h-px transition-all duration-700"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  )
}
