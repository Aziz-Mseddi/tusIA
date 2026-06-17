/**
 * AlertsTab — redesigned Monitor → Alerts section.
 *
 * Drop this file into:
 *   frontend/src/pages/monitoring/AlertsTab.tsx
 *
 * Then see README.md for the two-line change in InvestmentDashboardPage.tsx.
 */

import React from 'react'
import { clsx } from 'clsx'
import {
  Bell, BellOff, CheckCircle2, Clock,
  TrendingUp, FileText, AlertTriangle, Ban, Search, FileX,
} from 'lucide-react'
import type { MonitoringAlert } from '../../types'

// ─────────────────────────────────────────────────────────────────────────────
// Severity palette — stays within the project's warm brand tokens
// ─────────────────────────────────────────────────────────────────────────────
const SEV: Record<string, { color: string; rgb: string }> = {
  WARNING:  { color: '#C4A572', rgb: '196,165,114' },   // brass gold
  ALERT:    { color: '#C58A6B', rgb: '197,138,107' },   // terracotta
  CRITICAL: { color: '#B36B4C', rgb: '179,107,76'  },   // deep terracotta
  INFO:     { color: '#8C948A', rgb: '140,148,138' },   // sage / muted
}

function getSev(severity: string) {
  return SEV[severity] ?? SEV.INFO
}

// ─────────────────────────────────────────────────────────────────────────────
// Icon per alert type (contextual, not generic)
// ─────────────────────────────────────────────────────────────────────────────
const TYPE_ICON: Record<string, React.ElementType> = {
  overdue_milestone:                    Clock,
  unauthorized_cat:                     Ban,
  overspend:                            TrendingUp,
  pattern_round_amounts_no_receipt:     FileText,
  pattern_high_unverified_spend:        Search,
  missing_receipts:                     FileX,
}

/** Strip trailing _N index from a triggered_by code to get the base type. */
function alertType(triggeredBy: string): string {
  return triggeredBy.replace(/_\d+$/, '')
}

// ─────────────────────────────────────────────────────────────────────────────
// Human-readable titles (raw code preserved in the UI as a mono trace)
// ─────────────────────────────────────────────────────────────────────────────
const TITLE_MAP: Record<string, string> = {
  overdue_milestone:                    'Overdue Milestone',
  unauthorized_cat:                     'Unauthorized Category',
  overspend:                            'Overspend',
  pattern_round_amounts_no_receipt:     'Round Amounts, No Receipt',
  pattern_high_unverified_spend:        'High Unverified Spend',
  missing_receipts:                     'Missing Receipts',
}

function alertTitle(triggeredBy: string): string {
  const type = alertType(triggeredBy)
  return (
    TITLE_MAP[type] ??
    triggeredBy.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Strip emoji from message text (backend cleanup target — this is UI defence)
// ─────────────────────────────────────────────────────────────────────────────
const EMOJI_RE =
  /[\u{1F000}-\u{1FFFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}]+\s*/gu

function stripEmoji(text: string): string {
  return text.replace(EMOJI_RE, '').trim()
}

// ─────────────────────────────────────────────────────────────────────────────
// Split a message into clean bullet points: explicit line breaks first, then
// sentence boundaries. Keeps the copy compact and scannable.
// ─────────────────────────────────────────────────────────────────────────────
function toBullets(text: string): string[] {
  return stripEmoji(text)
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=\.)\s+(?=[A-Z0-9"“])/))
    .map((s) => s.trim())
    .filter(Boolean)
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────
interface AlertsTabProps {
  alerts: MonitoringAlert[]
  onAck: (id: number) => void
  isPending?: boolean
}

export function AlertsTab({ alerts, onAck, isPending }: AlertsTabProps) {
  const unread = alerts.filter((a) => !a.acknowledged)

  if (alerts.length === 0) {
    return (
      <div className="glass-card p-10 text-center animate-fade-in">
        <Bell size={28} className="text-success mx-auto mb-2" />
        <p className="text-success font-medium">All clear — no alerts</p>
      </div>
    )
  }

  return (
    <div className="space-y-3 animate-fade-in">

      {/* Section header */}
      <div className="flex items-baseline justify-between">
        <h3 className="section-title">{alerts.length} Monitoring Alerts</h3>
        <span
          className="font-mono text-[11px] tracking-wide"
          style={{
            color:
              unread.length > 0
                ? 'rgba(196,165,114,0.80)'
                : 'rgba(143,169,130,0.85)',
          }}
        >
          {unread.length > 0
            ? `${unread.length} unacknowledged`
            : 'All acknowledged'}
        </span>
      </div>

      {/* Alert cards */}
      <div className="space-y-2">
        {alerts.map((alert) => {
          const s = getSev(alert.severity)
          const isAck = alert.acknowledged
          const accentColor = isAck ? 'rgba(236,231,219,0.10)' : s.color
          const iconColor   = isAck ? 'rgba(236,231,219,0.28)' : s.color
          const Icon = TYPE_ICON[alertType(alert.triggered_by)] ?? AlertTriangle

          return (
            <div
              key={alert.id}
              className="flex items-start gap-4 transition-all duration-300"
              style={{
                position: 'relative',
                padding: '18px 22px 18px 24px',
                background: isAck
                  ? 'var(--surface-raised)'
                  : 'var(--surface-card)',
                border: '1px solid var(--hairline)',
                borderLeft: `2px solid ${accentColor}`,
                opacity: isAck ? 0.5 : 1,
              }}
            >
              {/* Icon chip */}
              <div
                className="flex-shrink-0 flex items-center justify-center"
                style={{
                  width: 44,
                  height: 44,
                  background: isAck
                    ? 'rgba(236,231,219,0.03)'
                    : `rgba(${s.rgb},0.08)`,
                  border: isAck
                    ? '1px solid rgba(236,231,219,0.08)'
                    : `1px solid rgba(${s.rgb},0.22)`,
                }}
              >
                <Icon size={20} strokeWidth={1.7} color={iconColor} />
              </div>

              {/* Body */}
              <div className="flex-1 min-w-0">

                {/* Title row */}
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-[15px] font-medium text-text-primary">
                    {alertTitle(alert.triggered_by)}
                  </span>
                  <span
                    className="font-mono text-[10px] tracking-[0.16em] px-2 py-[3px]"
                    style={{
                      color: isAck ? 'rgba(236,231,219,0.35)' : s.color,
                      border: isAck
                        ? '1px solid rgba(236,231,219,0.12)'
                        : `1px solid rgba(${s.rgb},0.32)`,
                      background: isAck ? 'transparent' : `rgba(${s.rgb},0.08)`,
                    }}
                  >
                    {alert.severity}
                  </span>
                  <span className="font-mono text-[11px] text-white/30 tracking-[0.02em]">
                    {alert.triggered_by}
                  </span>
                </div>

                {/* Message — emoji stripped, rendered as scannable bullets */}
                <ul className="mt-[8px] space-y-[5px]">
                  {toBullets(alert.message).map((point, i) => (
                    <li
                      key={i}
                      className="flex gap-[9px] text-[13.5px] leading-relaxed"
                      style={{ color: 'rgba(236,231,219,0.62)' } as React.CSSProperties}
                    >
                      <span
                        className="select-none flex-shrink-0 mt-[8px]"
                        style={{
                          width: 4,
                          height: 4,
                          borderRadius: 9999,
                          background: isAck ? 'rgba(236,231,219,0.28)' : s.color,
                        }}
                        aria-hidden
                      />
                      <span className="min-w-0">{point}</span>
                    </li>
                  ))}
                </ul>

                {/* Timestamp */}
                <div
                  className="flex items-center gap-[7px] mt-[11px] font-mono text-[11px]"
                  style={{ color: 'rgba(236,231,219,0.32)' }}
                >
                  <Clock size={12} strokeWidth={1.6} />
                  <span>{new Date(alert.created_at).toLocaleString()}</span>
                </div>
              </div>

              {/* Acknowledge control */}
              <div className="flex-shrink-0 self-start">
                {!isAck ? (
                  <button
                    onClick={() => onAck(alert.id)}
                    disabled={isPending}
                    className={clsx(
                      'inline-flex items-center gap-[7px] px-3 py-[7px]',
                      'font-mono text-[11px] tracking-[0.08em]',
                      'border border-white/10 text-text-muted',
                      'hover:border-white/30 hover:text-white',
                      'transition-all duration-150',
                      'disabled:opacity-40 disabled:cursor-not-allowed',
                    )}
                  >
                    <BellOff size={13} strokeWidth={1.6} />
                    Acknowledge
                  </button>
                ) : (
                  <span
                    className="inline-flex items-center gap-[7px] font-mono text-[11px] tracking-[0.08em] px-[2px] py-[7px]"
                    style={{ color: 'rgba(236,231,219,0.32)' }}
                  >
                    <CheckCircle2 size={13} strokeWidth={1.6} />
                    Acknowledged
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
