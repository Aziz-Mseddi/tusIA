import { Link } from 'react-router-dom'
import { ScoreRing } from './ScoreRing'
import { GradeBadge, ZoneBadge, Badge } from '../ui/Badge'
import type { Startup } from '../../types'
import { clsx } from 'clsx'

interface StartupCardProps {
  startup: Startup
  compact?: boolean
}

const exitColors: Record<string, 'success' | 'info' | 'warning' | 'danger' | 'muted'> = {
  active: 'success',
  acquired: 'info',
  ipo: 'warning',
  failed: 'danger',
}

export function StartupCard({ startup, compact = false }: StartupCardProps) {
  const { score_result: s } = startup

  return (
    <Link
      to={`/mode1/startup/${startup.id}`}
      className={clsx(
        'group block border border-white/[0.06] transition-all duration-200',
        'hover:border-white/[0.14]',
        compact ? 'p-4' : 'p-5'
      )}
      style={{ background: 'var(--surface-card)' }}
    >
      <div className="flex items-start gap-4">
        <ScoreRing score={s.final_score} size={compact ? 56 : 68} strokeWidth={5} grade={s.grade} />

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="min-w-0">
              <h3 className="text-sm font-normal text-white group-hover:text-gold transition-colors leading-tight truncate">
                {startup.name}
              </h3>
              <p className="text-[11px] text-white/30 mt-0.5 tracking-wide">
                {startup.country} / {startup.sector}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1 flex-shrink-0">
              <GradeBadge grade={s.grade} />
              <ZoneBadge zone={s.decision_zone} />
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <Badge variant="muted">{startup.stage}</Badge>
            <Badge variant="muted">{startup.business_model}</Badge>
            <Badge variant={exitColors[startup.exit_status] ?? 'muted'}>{startup.exit_status}</Badge>
            {startup.tech_enabled && <Badge variant="info">Tech</Badge>}
          </div>
        </div>
      </div>

      {!compact && (
        <div className="flex items-center justify-between mt-4 pt-3 border-t border-white/[0.05]">
          <div className="flex items-center gap-4 text-[11px] text-white/30">
            <span>{startup.employees.toLocaleString()} emp</span>
            <span>ROI {(s.estimated_roi * 100).toFixed(0)}%</span>
            {startup.ebitda_margin != null && <span>EBITDA {startup.ebitda_margin.toFixed(0)}%</span>}
          </div>
          <span className="text-[11px] text-white/20 tracking-widest uppercase">{s.risk_level} Risk</span>
        </div>
      )}
    </Link>
  )
}
