import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronUp, ArrowRight, Bell, Calendar, Clock, Settings, ShieldAlert, Flame } from 'lucide-react'
import { clsx } from 'clsx'
import { Layout } from '../../components/layout/Layout'
import { UnifiedCalendar } from '../../components/monitoring/UnifiedCalendar'
import { StatusBadge } from '../../components/ui/Badge'
import { FullPageSpinner } from '../../components/ui/Spinner'
import { monitoringApi } from '../../api/monitoring'
import { FUND_FLOW_COLORS } from '../../utils/fundFlow'
import type { PortfolioInvestmentSummary, PortfolioStatusBreakdown } from '../../types'

function BreakdownCard({ title, data }: { title: string; data: PortfolioStatusBreakdown }) {
  return (
    <div className="glass-card p-5">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="section-title">{title}</h3>
        <span className="text-2xl font-black text-text-primary">{data.total}</span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-text-secondary">
        <span>Pending</span><span className="text-right text-text-primary font-medium">{data.pending}</span>
        <span>In Progress</span><span className="text-right text-blue-400 font-medium">{data.in_progress}</span>
        <span>Overdue</span><span className="text-right text-danger font-medium">{data.overdue}</span>
        <span>Fulfilled</span><span className="text-right text-success font-medium">{data.fulfilled}</span>
      </div>
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/[0.05] text-xs">
        <span className="text-text-muted">At Risk</span>
        <span className={clsx('font-semibold', data.at_risk > 0 ? 'text-warning' : 'text-text-secondary')}>{data.at_risk}</span>
      </div>
    </div>
  )
}

function PhaseBadge({ status }: { status: string }) {
  const color = FUND_FLOW_COLORS[status] ?? '#8C948A'
  return (
    <span
      className="text-[10px] px-1.5 py-0.5 border font-medium tracking-wider"
      style={{ color, borderColor: `${color}40`, background: `${color}15` }}
    >
      {status}
    </span>
  )
}

function InvestmentRow({ inv }: { inv: PortfolioInvestmentSummary }) {
  const [open, setOpen] = useState(false)
  const daysLeft = inv.days_remaining
  const urgent = daysLeft != null && daysLeft < 30

  return (
    <div className="glass-card overflow-hidden">
      <div className="p-5 flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-text-primary text-base">{inv.startup_name}</h3>
            <span className={clsx(
              'text-xs px-2 py-0.5 rounded-md border font-medium',
              inv.stage === 'creation' ? 'bg-blue-500/15 text-blue-400 border-blue-500/25' :
              inv.stage === 'development' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25' :
              'bg-amber-500/15 text-amber-400 border-amber-500/25'
            )}>{inv.stage}</span>
          </div>
          {inv.startup_sector && <p className="text-xs text-text-muted mt-0.5">{inv.startup_sector}</p>}

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4">
            <div className="flex items-center gap-1.5 text-xs text-text-secondary">
              <Calendar size={12} className="text-text-muted" />
              <span>{inv.contract_start_date}</span>
            </div>
            <div className={clsx('flex items-center gap-1.5 text-xs', urgent ? 'text-danger' : 'text-text-secondary')}>
              <Clock size={12} className={urgent ? 'text-danger' : 'text-text-muted'} />
              <span>{daysLeft != null ? `${daysLeft}d remaining` : inv.contract_end_date}</span>
            </div>
            {inv.unacknowledged_alerts > 0 ? (
              <div className="flex items-center gap-1.5 text-xs text-danger">
                <Bell size={12} />
                <span>{inv.unacknowledged_alerts} unread alert{inv.unacknowledged_alerts > 1 ? 's' : ''}</span>
              </div>
            ) : (
              <span className="text-xs text-text-muted">No pending alerts</span>
            )}
          </div>
        </div>

        <div className="flex flex-col items-end gap-2 flex-shrink-0">
          <Link to={`/monitoring/${inv.id}`} className="btn-primary text-xs py-1.5 px-3">
            View Dashboard <ArrowRight size={12} />
          </Link>
          <button onClick={() => setOpen((o) => !o)} className="btn-ghost text-xs gap-1">
            {open ? <>Hide Details <ChevronUp size={13} /></> : <>Show Details <ChevronDown size={13} /></>}
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-white/[0.06] p-5 space-y-5 animate-fade-in">
          {/* Clauses */}
          <div>
            <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">Contract Clauses ({inv.clauses.length})</h4>
            {inv.clauses.length === 0 ? (
              <p className="text-xs text-text-muted">No clauses recorded.</p>
            ) : (
              <div className="space-y-1.5">
                {inv.clauses.map((c) => (
                  <div key={c.id} className="p-2.5 bg-white/[0.02] border border-white/[0.05]">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-semibold text-text-primary">{inv.startup_name}</span>
                      <StatusBadge status={c.status} />
                      {c.due_date && <span className="text-[10px] text-text-muted ml-auto">Due {c.due_date}</span>}
                    </div>
                    <p className="text-xs text-text-secondary">{c.description}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Milestones */}
          <div>
            <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">Plan Milestones ({inv.milestones.length})</h4>
            {inv.milestones.length === 0 ? (
              <p className="text-xs text-text-muted">No milestones recorded.</p>
            ) : (
              <div className="space-y-1.5">
                {inv.milestones.map((m) => (
                  <div key={m.id} className="p-2.5 bg-white/[0.02] border border-white/[0.05]">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-semibold text-text-primary">{inv.startup_name}</span>
                      <StatusBadge status={m.status} />
                      {m.due_date && <span className="text-[10px] text-text-muted ml-auto">Due {m.due_date}</span>}
                    </div>
                    <p className="text-xs text-text-secondary">{m.description}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Fund Flow */}
          <div>
            <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">Fund Flow ({inv.fund_flow.length})</h4>
            {inv.fund_flow.length === 0 ? (
              <p className="text-xs text-text-muted">No fund allocations recorded.</p>
            ) : (
              <div className="space-y-1.5">
                {inv.fund_flow.map((f) => (
                  <div key={f.category} className="p-2.5 bg-white/[0.02] border border-white/[0.05]">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-semibold text-text-primary">{inv.startup_name}</span>
                      <PhaseBadge status={f.status} />
                      <span className="text-[10px] text-text-muted ml-auto">
                        {f.actual.toLocaleString()} / {f.agreed.toLocaleString()} TND
                      </span>
                    </div>
                    <p className="text-xs text-text-secondary">{f.category}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function GlobalDashboardPage() {
  const [selectedStartups, setSelectedStartups] = useState<string[]>([])

  const { data, isLoading } = useQuery({
    queryKey: ['portfolio-overview'],
    queryFn: monitoringApi.portfolioOverview,
  })

  const allStartups = useMemo(
    () => Array.from(new Set((data?.investments ?? []).map((i) => i.startup_name))),
    [data]
  )

  const filteredTimeline = useMemo(() => {
    if (!data) return []
    if (selectedStartups.length === 0) return data.timeline
    return data.timeline.filter((ev) => selectedStartups.includes(ev.startup_name))
  }, [data, selectedStartups])

  if (isLoading) return <Layout title="Global Investments Dashboard"><FullPageSpinner /></Layout>
  if (!data) return <Layout title="Global Investments Dashboard"><p className="text-text-muted">Unable to load portfolio overview.</p></Layout>

  const { summary, investments } = data

  return (
    <Layout title="Global Investments Dashboard">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h2 className="page-title">Global Investments Dashboard</h2>
          <p className="text-sm text-text-muted mt-1">A unified view across {investments.length} portfolio{investments.length !== 1 ? 's' : ''}</p>
        </div>
        <Link to="/monitoring" className="btn-secondary text-sm">
          <Settings size={14} /> Manage Investments
        </Link>
      </div>

      {investments.length === 0 ? (
        <div className="glass-card p-14 text-center">
          <h3 className="text-lg font-semibold text-text-secondary">No investments yet</h3>
          <p className="text-sm text-text-muted mt-1 mb-5">Add investments to see them on the global timeline and metrics.</p>
          <Link to="/monitoring" className="btn-primary inline-flex">Manage Investments</Link>
        </div>
      ) : (
        <div className="space-y-6">
          {/* 1. Unified Calendar */}
          <UnifiedCalendar
            events={filteredTimeline}
            allStartups={allStartups}
            selectedStartups={selectedStartups}
            onSelectedStartupsChange={setSelectedStartups}
          />

          {/* 2. High-level metrics & aggregated insights */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <BreakdownCard title="Contract Clauses" data={summary.clauses} />
            <BreakdownCard title="Plan Milestones" data={summary.milestones} />
            <div className="glass-card p-5">
              <h3 className="section-title mb-3">Risk Assessment</h3>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <ShieldAlert size={18} className={summary.at_risk_total > 0 ? 'text-warning' : 'text-text-muted'} />
                  <div>
                    <p className="text-xl font-black text-text-primary">{summary.at_risk_total}</p>
                    <p className="text-xs text-text-muted">At-risk items (clauses + milestones)</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Flame size={18} className={summary.suspicious_patterns_count > 0 ? 'text-danger' : 'text-text-muted'} />
                  <div>
                    <p className="text-xl font-black text-text-primary">{summary.suspicious_patterns_count}</p>
                    <p className="text-xs text-text-muted">Suspicious patterns detected</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 3. Centralized Investment Portfolio List */}
          <div>
            <h3 className="section-title mb-3">Investment Portfolio</h3>
            <div className="space-y-3">
              {investments.map((inv) => <InvestmentRow key={inv.id} inv={inv} />)}
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}
