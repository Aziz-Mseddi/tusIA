import { clsx } from 'clsx'
import type { ReactNode } from 'react'

interface BadgeProps {
  children: ReactNode
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'critical' | 'muted'
  size?: 'sm' | 'md'
  className?: string
}

const variants: Record<string, string> = {
  default: 'text-white/50 border-white/15',
  success: 'text-green-400 border-green-400/30',
  warning: 'text-amber-400 border-amber-400/30',
  danger: 'text-red-400 border-red-400/30',
  critical: 'text-red-300 border-red-300/30',
  info: 'text-blue-400 border-blue-400/30',
  muted: 'text-white/30 border-white/10',
}

export function Badge({ children, variant = 'default', size = 'sm', className }: BadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center border font-light',
        size === 'sm' ? 'px-2 py-0.5 text-[11px] tracking-wide' : 'px-2.5 py-1 text-xs tracking-wider',
        variants[variant],
        className
      )}
    >
      {children}
    </span>
  )
}

export function GradeBadge({ grade }: { grade: string }) {
  const map: Record<string, string> = {
    A: 'badge-grade-a',
    B: 'badge-grade-b',
    C: 'badge-grade-c',
    D: 'badge-grade-d',
    F: 'badge-grade-f',
  }
  return (
    <span className={clsx('inline-flex items-center border px-2 py-0.5 text-[11px] font-normal tracking-wider', map[grade] ?? 'badge-grade-f')}>
      {grade}
    </span>
  )
}

export function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, string> = {
    INFO: 'severity-info',
    WARNING: 'severity-warning',
    ALERT: 'severity-alert',
    CRITICAL: 'severity-critical',
  }
  return (
    <span className={clsx('inline-flex items-center border px-2 py-0.5 text-[11px] tracking-wider', map[severity] ?? 'severity-info')}>
      {severity}
    </span>
  )
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: 'text-white/40 border-white/15',
    in_progress: 'text-blue-400 border-blue-400/30',
    fulfilled: 'text-green-400 border-green-400/30',
    overdue: 'text-red-400 border-red-400/30',
  }
  const labels: Record<string, string> = {
    pending: 'Pending',
    in_progress: 'In Progress',
    fulfilled: 'Fulfilled',
    overdue: 'Overdue',
  }
  return (
    <span className={clsx('inline-flex items-center border px-2 py-0.5 text-[11px] tracking-wider', map[status] ?? 'text-white/30 border-white/10')}>
      {labels[status] ?? status}
    </span>
  )
}

export function ZoneBadge({ zone }: { zone: string }) {
  const map: Record<string, string> = {
    Green: 'text-green-400 border-green-400/30',
    Orange: 'text-amber-400 border-amber-400/30',
    Red: 'text-red-400 border-red-400/30',
  }
  return (
    <span className={clsx('inline-flex items-center border px-2 py-0.5 text-[11px] tracking-wider', map[zone] ?? 'text-white/30 border-white/10')}>
      {zone}
    </span>
  )
}

export function RiskBadge({ risk }: { risk: string }) {
  const map: Record<string, string> = {
    Low: 'text-green-400 border-green-400/30',
    Medium: 'text-amber-400 border-amber-400/30',
    High: 'text-red-400 border-red-400/30',
  }
  return (
    <span className={clsx('inline-flex items-center border px-2 py-0.5 text-[11px] tracking-wider', map[risk] ?? 'text-white/30 border-white/10')}>
      {risk} Risk
    </span>
  )
}
