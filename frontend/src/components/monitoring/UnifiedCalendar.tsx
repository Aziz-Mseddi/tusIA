import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval,
  addMonths, addWeeks, addDays, isSameMonth, isToday,
} from 'date-fns'
import { ChevronLeft, ChevronRight, Filter, ArrowRight } from 'lucide-react'
import { clsx } from 'clsx'
import { Modal } from '../ui/Modal'
import { StatusBadge, SeverityBadge } from '../ui/Badge'
import type { TimelineEvent } from '../../types'

type CalendarView = 'month' | 'week' | 'day'

const LIQUIDITY_CLAUSE_TYPES = new Set(['put_option', 'drag_along', 'tag_along', 'ratchet'])

function eventColorClasses(ev: TimelineEvent): string {
  if (ev.type === 'clause' && ev.clause_type && LIQUIDITY_CLAUSE_TYPES.has(ev.clause_type)) {
    return 'text-purple-400 border-purple-400/30 bg-purple-500/10'
  }
  if (ev.type === 'clause' || ev.type === 'milestone') {
    return 'text-blue-400 border-blue-400/30 bg-blue-500/10'
  }
  switch (ev.severity) {
    case 'CRITICAL':
    case 'ALERT':
      return 'text-danger border-danger/30 bg-danger/10'
    case 'WARNING':
      return 'text-gold border-gold/30 bg-gold/10'
    case 'INFO':
      return 'text-text-secondary border-border-mid bg-white/[0.03]'
    default:
      // fund flow with no flagged severity ("OK")
      return 'text-success border-success/30 bg-success/10'
  }
}

function eventTypeLabel(ev: TimelineEvent): string {
  switch (ev.type) {
    case 'clause': return 'Clause due'
    case 'milestone': return 'Milestone due'
    case 'fund_flow': return 'Fund flow'
    case 'alert': return 'Alert'
  }
}

function EventChip({ ev, onClick }: { ev: TimelineEvent; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={clsx('w-full text-left px-1.5 py-0.5 border text-[10px] leading-tight truncate', eventColorClasses(ev))}
      title={`${ev.startup_name} — ${ev.title}`}
    >
      <span className="font-semibold">{ev.startup_name}</span>
      <span className="opacity-70"> · {ev.title}</span>
    </button>
  )
}

function EventRow({ ev }: { ev: TimelineEvent }) {
  return (
    <div className={clsx('p-3 border', eventColorClasses(ev))}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="font-semibold text-text-primary text-sm">{ev.startup_name}</span>
        {ev.type === 'alert' && ev.severity && <SeverityBadge severity={ev.severity} />}
        {(ev.type === 'clause' || ev.type === 'milestone') && ev.status && <StatusBadge status={ev.status} />}
        {ev.type === 'fund_flow' && (
          <span className="text-[11px] tracking-wider opacity-80">
            {ev.amount != null ? `${ev.amount.toLocaleString()} TND` : ''}
          </span>
        )}
      </div>
      <p className="text-xs text-text-secondary">
        <span className="opacity-60">{eventTypeLabel(ev)}: </span>{ev.title}
      </p>
      <div className="flex items-center justify-between mt-1.5">
        <span className="text-[10px] text-text-muted">{ev.date}</span>
        <Link to={`/monitoring/${ev.investment_id}`} className="text-[10px] text-text-muted hover:text-text-primary inline-flex items-center gap-1">
          View investment <ArrowRight size={10} />
        </Link>
      </div>
    </div>
  )
}

interface UnifiedCalendarProps {
  events: TimelineEvent[]
  allStartups: string[]
  selectedStartups: string[]
  onSelectedStartupsChange: (names: string[]) => void
  title?: string
  hideFilter?: boolean
}

export function UnifiedCalendar({ events, allStartups, selectedStartups, onSelectedStartupsChange, title, hideFilter }: UnifiedCalendarProps) {
  const [view, setView] = useState<CalendarView>('month')
  const [cursor, setCursor] = useState(new Date())
  const [filterOpen, setFilterOpen] = useState(false)
  const [dayModal, setDayModal] = useState<Date | null>(null)

  const eventsByDay = useMemo(() => {
    const map = new Map<string, TimelineEvent[]>()
    for (const ev of events) {
      if (!ev.date) continue
      const key = ev.date
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(ev)
    }
    return map
  }, [events])

  function getDayEvents(day: Date): TimelineEvent[] {
    return eventsByDay.get(format(day, 'yyyy-MM-dd')) ?? []
  }

  function goPrev() {
    if (view === 'month') setCursor((c) => addMonths(c, -1))
    else if (view === 'week') setCursor((c) => addWeeks(c, -1))
    else setCursor((c) => addDays(c, -1))
  }
  function goNext() {
    if (view === 'month') setCursor((c) => addMonths(c, 1))
    else if (view === 'week') setCursor((c) => addWeeks(c, 1))
    else setCursor((c) => addDays(c, 1))
  }
  function goToday() {
    setCursor(new Date())
  }

  function toggleStartup(name: string) {
    if (selectedStartups.includes(name)) {
      onSelectedStartupsChange(selectedStartups.filter((s) => s !== name))
    } else {
      onSelectedStartupsChange([...selectedStartups, name])
    }
  }

  const periodLabel = useMemo(() => {
    if (view === 'month') return format(cursor, 'MMMM yyyy')
    if (view === 'week') {
      const start = startOfWeek(cursor)
      const end = endOfWeek(cursor)
      return `${format(start, 'MMM d')} – ${format(end, 'MMM d, yyyy')}`
    }
    return format(cursor, 'EEEE, MMMM d, yyyy')
  }, [view, cursor])

  return (
    <div className="glass-card p-5">
      {/* Header: view toggle, navigation, filter */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <h3 className="section-title">{title ?? 'Unified Investment Timeline'}</h3>
          <div className="flex gap-1">
            {(['month', 'week', 'day'] as CalendarView[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={clsx('px-3 py-1.5 text-xs font-medium capitalize', view === v ? 'tab-active' : 'tab-inactive')}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={goPrev} className="btn-ghost p-1.5"><ChevronLeft size={14} /></button>
          <button onClick={goToday} className="btn-secondary text-xs py-1 px-2">Today</button>
          <button onClick={goNext} className="btn-ghost p-1.5"><ChevronRight size={14} /></button>
          <span className="text-sm text-text-secondary min-w-[150px] text-center">{periodLabel}</span>

          {!hideFilter && (
            <div className="relative">
              <button onClick={() => setFilterOpen((o) => !o)} className="btn-secondary text-xs py-1.5 px-2.5 gap-1.5">
                <Filter size={12} />
                {selectedStartups.length === 0 ? 'All Startups' : `${selectedStartups.length} selected`}
              </button>
              {filterOpen && (
                <div className="absolute right-0 mt-1 w-56 max-h-64 overflow-y-auto z-20 border border-white/[0.08] p-2 space-y-1" style={{ background: 'var(--panel-bg)' }}>
                  <button
                    onClick={() => onSelectedStartupsChange([])}
                    className="w-full text-left text-xs text-text-muted hover:text-text-primary px-2 py-1"
                  >
                    Clear filter (show all)
                  </button>
                  {allStartups.map((name) => (
                    <label key={name} className="flex items-center gap-2 px-2 py-1 text-xs text-text-secondary hover:text-text-primary cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedStartups.includes(name)}
                        onChange={() => toggleStartup(name)}
                        className="accent-primary w-3.5 h-3.5"
                      />
                      {name}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 mb-4 text-[11px] text-text-muted">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 inline-block bg-blue-400/60 border border-blue-400/40" /> Upcoming milestone / clause</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 inline-block bg-purple-400/60 border border-purple-400/40" /> Liquidity right</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 inline-block bg-gold/60 border border-gold/40" /> Warning</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 inline-block bg-danger/60 border border-danger/40" /> Alert / Critical</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 inline-block bg-white/20 border border-white/20" /> Info</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 inline-block bg-success/60 border border-success/40" /> Fund flow</span>
      </div>

      {/* Month view */}
      {view === 'month' && (
        <MonthGrid cursor={cursor} getDayEvents={getDayEvents} onDayClick={setDayModal} />
      )}

      {/* Week view */}
      {view === 'week' && (
        <WeekGrid cursor={cursor} getDayEvents={getDayEvents} />
      )}

      {/* Day view */}
      {view === 'day' && (
        <div className="space-y-2">
          {getDayEvents(cursor).length === 0 ? (
            <p className="text-sm text-text-muted text-center py-8">No events on this day</p>
          ) : (
            getDayEvents(cursor).map((ev) => <EventRow key={ev.id} ev={ev} />)
          )}
        </div>
      )}

      {/* Day detail modal (month view "+N more" / day click) */}
      <Modal open={!!dayModal} onClose={() => setDayModal(null)} title={dayModal ? format(dayModal, 'EEEE, MMMM d, yyyy') : ''} size="lg">
        <div className="space-y-2">
          {dayModal && getDayEvents(dayModal).length === 0 && (
            <p className="text-sm text-text-muted text-center py-4">No events on this day</p>
          )}
          {dayModal && getDayEvents(dayModal).map((ev) => <EventRow key={ev.id} ev={ev} />)}
        </div>
      </Modal>
    </div>
  )
}

function MonthGrid({ cursor, getDayEvents, onDayClick }: {
  cursor: Date
  getDayEvents: (d: Date) => TimelineEvent[]
  onDayClick: (d: Date) => void
}) {
  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor))
    const end = endOfWeek(endOfMonth(cursor))
    return eachDayOfInterval({ start, end })
  }, [cursor])

  const MAX_CHIPS = 3

  return (
    <div className="grid grid-cols-7 gap-1">
      {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
        <div key={d} className="text-[11px] text-text-muted font-medium text-center py-1">{d}</div>
      ))}
      {days.map((day) => {
        const dayEvents = getDayEvents(day)
        const inMonth = isSameMonth(day, cursor)
        return (
          <div
            key={day.toISOString()}
            className={clsx(
              'min-h-[92px] p-1 border border-white/[0.05] flex flex-col gap-0.5',
              inMonth ? 'bg-white/[0.01]' : 'bg-transparent opacity-40',
              isToday(day) && 'border-gold/40'
            )}
          >
            <span className={clsx('text-[11px] px-1', isToday(day) ? 'text-gold font-semibold' : 'text-text-muted')}>
              {format(day, 'd')}
            </span>
            <div className="flex flex-col gap-0.5 flex-1 overflow-hidden">
              {dayEvents.slice(0, MAX_CHIPS).map((ev) => (
                <EventChip key={ev.id} ev={ev} onClick={() => onDayClick(day)} />
              ))}
              {dayEvents.length > MAX_CHIPS && (
                <button onClick={() => onDayClick(day)} className="text-[10px] text-text-muted hover:text-text-primary text-left px-1.5">
                  +{dayEvents.length - MAX_CHIPS} more
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function WeekGrid({ cursor, getDayEvents }: { cursor: Date; getDayEvents: (d: Date) => TimelineEvent[] }) {
  const days = useMemo(() => {
    const start = startOfWeek(cursor)
    const end = endOfWeek(cursor)
    return eachDayOfInterval({ start, end })
  }, [cursor])

  return (
    <div className="grid grid-cols-1 sm:grid-cols-7 gap-2">
      {days.map((day) => {
        const dayEvents = getDayEvents(day)
        return (
          <div key={day.toISOString()} className={clsx('border border-white/[0.05] p-2 min-h-[140px]', isToday(day) && 'border-gold/40')}>
            <p className={clsx('text-xs font-medium mb-2', isToday(day) ? 'text-gold' : 'text-text-secondary')}>
              {format(day, 'EEE d')}
            </p>
            <div className="space-y-1">
              {dayEvents.length === 0 ? (
                <p className="text-[11px] text-text-muted">—</p>
              ) : (
                dayEvents.map((ev) => (
                  <div key={ev.id} className={clsx('px-1.5 py-1 border text-[11px] leading-tight', eventColorClasses(ev))}>
                    <span className="font-semibold">{ev.startup_name}</span>
                    <p className="opacity-80 truncate">{ev.title}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
