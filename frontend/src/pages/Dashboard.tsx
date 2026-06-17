import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Search, FlaskConical, BarChart3, MessageSquare, Bell, AlertTriangle, ArrowRight, TrendingUp, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
import { Layout } from '../components/layout/Layout'
import { Spinner } from '../components/ui/Spinner'
import { monitoringApi } from '../api/monitoring'
import { startupsApi } from '../api/startups'
import { mode1Api } from '../api/mode1'
import { useAuthStore } from '../store/authStore'

const MODULES = [
  {
    num: '01',
    to: '/mode1',
    icon: Search,
    title: 'Discover',
    desc: 'Browse & filter the startup database with AI-powered search across MENA, Africa & Asia.',
  },
  {
    num: '02',
    to: '/mode2',
    icon: FlaskConical,
    title: 'Assess',
    desc: 'Upload documents and receive an AI-powered viability verdict with comparable company analysis.',
  },
  {
    num: '03',
    to: '/monitoring',
    icon: BarChart3,
    title: 'Monitor',
    desc: 'Track contracts, milestones, and fund allocations. Get automated compliance alerts.',
  },
  {
    num: '04',
    to: '/chat',
    icon: MessageSquare,
    title: 'Consult',
    desc: 'Ask TunisIA anything about investments, markets, and financial due diligence.',
  },
]

export default function Dashboard() {
  const { investor } = useAuthStore()
  const qc = useQueryClient()

  const { data: investmentsData } = useQuery({ queryKey: ['investments'], queryFn: monitoringApi.list })
  const { data: meta } = useQuery({ queryKey: ['startups-meta'], queryFn: startupsApi.meta })

  // Sector Thesis Scout — the persisted weekly run (live block). Falls back to the
  // on-demand /suggestions content only when no run has been generated yet.
  const { data: themesData } = useQuery({ queryKey: ['themes-latest'], queryFn: mode1Api.themesLatest })
  const themeRun = themesData?.run ?? null
  const { data: suggestions } = useQuery({
    queryKey: ['suggestions'],
    queryFn: mode1Api.suggestions,
    staleTime: 300_000,
    enabled: themesData != null && themeRun == null,
  })

  const runThemes = useMutation({
    mutationFn: mode1Api.runThemesNow,
    onSuccess: (res) => {
      toast.success(res.run.source === 'fallback'
        ? 'Newsletter generated (offline template — AI unavailable)'
        : 'Fresh market-trends newsletter generated')
      qc.invalidateQueries({ queryKey: ['themes-latest'] })
    },
    onError: () => toast.error('Could not generate newsletter'),
  })

  const investments = investmentsData?.investments ?? []
  const totalAlerts = investments.reduce((a, i) => a + (i.unacknowledged_alerts || 0), 0)
  const criticalInvestments = investments.filter((i) => (i.days_remaining ?? Infinity) < 30 && i.days_remaining != null)

  return (
    <Layout title="Dashboard">
      {/* Hero */}
      <div className="relative mb-16 pt-8 overflow-hidden">
        <div
          className="absolute top-0 left-0 right-0 leading-none font-thin text-white select-none pointer-events-none"
          style={{ fontSize: 'clamp(80px, 14vw, 180px)', opacity: 0.028, lineHeight: 0.85, letterSpacing: '-0.04em' }}
          aria-hidden
        >
          INVEST
        </div>
        <div className="relative">
          <p className="text-[11px] tracking-[0.2em] uppercase text-white/25 mb-4">
            Investment Intelligence
          </p>
          <h1 className="text-4xl font-thin text-white leading-tight">
            Welcome,{' '}
            <span className="text-gold">{investor?.full_name?.split(' ')[0] || investor?.email?.split('@')[0]}</span>
          </h1>
          <p className="text-sm text-white/30 mt-3 font-light">Your platform is ready. {meta?.total ?? '—'} startups indexed across {meta?.sectors?.length ?? '—'} sectors.</p>
        </div>
      </div>

      {/* Status strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px border border-white/[0.06] mb-14" style={{ background: 'var(--hairline)' }}>
        {[
          { label: 'Active Investments', value: investments.length },
          { label: 'Pending Alerts', value: totalAlerts, highlight: totalAlerts > 0 },
          { label: 'At-Risk Contracts', value: criticalInvestments.length, highlight: criticalInvestments.length > 0 },
          { label: 'Startup Database', value: meta?.total ?? '—' },
        ].map((stat) => (
          <div key={stat.label} className="px-6 py-5" style={{ background: 'var(--surface-card)' }}>
            <p className={`text-2xl font-thin ${stat.highlight ? 'text-gold' : 'text-white'}`}>{stat.value}</p>
            <p className="text-[10px] tracking-widest uppercase text-white/25 mt-1">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Module grid */}
      <div className="mb-14">
        <p className="text-[11px] tracking-[0.2em] uppercase text-white/25 mb-8">Platform modules</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-0 border border-white/[0.06]">
          {MODULES.map((mod, idx) => {
            const Icon = mod.icon
            return (
              <Link
                key={mod.num}
                to={mod.to}
                className={`group p-8 flex flex-col gap-6 transition-all duration-200 border-t-2 border-t-transparent hover:border-t-gold ${idx < 3 ? 'border-r border-r-white/[0.06]' : ''}`}
                style={{ background: 'var(--surface-card)' }}
              >
                <div className="flex items-start justify-between">
                  <span className="text-[11px] tracking-widest text-white/20">{mod.num}</span>
                  <Icon size={18} className="text-white/20 group-hover:text-gold transition-colors" strokeWidth={1.5} />
                </div>
                <div>
                  <h3 className="text-lg font-thin text-white group-hover:text-gold transition-colors tracking-wide mb-2">
                    {mod.title}
                  </h3>
                  <p className="text-xs text-white/30 leading-relaxed font-light">{mod.desc}</p>
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-white/20 group-hover:text-gold/70 transition-colors mt-auto">
                  <span className="tracking-wider uppercase">Enter</span>
                  <ArrowRight size={11} />
                </div>
              </Link>
            )
          })}
        </div>
      </div>

      {/* Portfolio section */}
      {investments.length > 0 && (
        <div className="mb-14">
          <div className="flex items-center justify-between mb-6">
            <p className="text-[11px] tracking-[0.2em] uppercase text-white/25">Active portfolio</p>
            <Link to="/monitoring" className="text-[11px] tracking-widest uppercase text-gold hover:text-white transition-colors flex items-center gap-1.5">
              View all <ArrowRight size={11} />
            </Link>
          </div>
          <div className="border border-white/[0.06]">
            {investments.slice(0, 5).map((inv, idx) => (
              <Link
                key={inv.id}
                to={`/monitoring/${inv.id}`}
                className={`flex items-center justify-between px-6 py-4 hover:bg-white/[0.03] transition-colors group ${idx < investments.slice(0, 5).length - 1 ? 'border-b border-white/[0.04]' : ''}`}
              >
                <div className="flex items-center gap-4">
                  <span className="text-[10px] tracking-widest text-white/20 w-6">{String(idx + 1).padStart(2, '0')}</span>
                  <div>
                    <p className="text-sm text-white/70 group-hover:text-white transition-colors">{inv.startup_name}</p>
                    <p className="text-[11px] text-white/25 mt-0.5">
                      {inv.days_remaining != null ? `${inv.days_remaining} days remaining` : 'No end date'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  {inv.unacknowledged_alerts > 0 && (
                    <div className="flex items-center gap-1.5 text-[11px] text-gold">
                      <Bell size={11} />
                      <span>{inv.unacknowledged_alerts}</span>
                    </div>
                  )}
                  {(inv.days_remaining ?? Infinity) < 30 && inv.days_remaining != null && (
                    <div className="flex items-center gap-1.5 text-[11px] text-red-400">
                      <AlertTriangle size={11} />
                      <span>Critical</span>
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* AI Themes — Sector Thesis Scout (live weekly run + on-demand) */}
      {(themeRun || (suggestions && suggestions.suggestions.length > 0)) && (
        <div>
          <div className="flex items-center justify-between mb-8">
            <p className="text-[11px] tracking-[0.2em] uppercase text-white/25 flex items-center gap-2">
              <TrendingUp size={13} /> AI investment themes
              {themeRun && !themeRun.read && <span className="w-1.5 h-1.5 rounded-full bg-gold" />}
            </p>
            <div className="flex items-center gap-4">
              {themeRun?.generated_at && (
                <span className="text-[10px] tracking-wider uppercase text-white/20">
                  Updated {fmtUpdated(themeRun.generated_at)}
                </span>
              )}
              <button
                onClick={() => runThemes.mutate()}
                disabled={runThemes.isPending}
                className="text-[11px] tracking-widest uppercase text-gold hover:text-white transition-colors flex items-center gap-1.5 disabled:opacity-40"
              >
                {runThemes.isPending ? <Spinner /> : <RefreshCw size={11} />} Run now
              </button>
            </div>
          </div>

          {/* What changed this week */}
          {themeRun && themeRun.diff.length > 0 && (
            <div className="border border-white/[0.06] px-6 py-4 mb-6" style={{ background: 'rgba(212,175,55,0.03)' }}>
              <p className="text-[10px] tracking-widest uppercase text-gold/70 mb-2.5">What changed this week</p>
              <ul className="space-y-1">
                {themeRun.diff.slice(0, 5).map((d, i) => (
                  <li key={i} className="text-xs text-white/45 leading-relaxed flex gap-2">
                    <span className="text-gold/50">·</span>{d}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Ranked theses (live run) or fallback suggestions */}
          {themeRun ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-0 border border-white/[0.06]">
              {themeRun.theses.slice(0, 3).map((t, i) => (
                <div
                  key={t.rank}
                  className={`p-7 ${i < 2 ? 'border-r border-white/[0.06]' : ''}`}
                  style={{ background: 'var(--surface-card)' }}
                >
                  <div className="flex items-start justify-between mb-4">
                    <span className="text-[11px] tracking-widest text-white/20">#{t.rank}</span>
                    <span className={`text-[10px] tracking-widest uppercase px-2 py-1 border ${
                      t.risk_level === 'Low' ? 'border-green-400/30 text-green-400' :
                      t.risk_level === 'Medium' ? 'border-amber-400/30 text-amber-400' :
                      'border-red-400/30 text-red-400'
                    }`}>{t.risk_level} risk</span>
                  </div>
                  <h4 className="text-base font-thin text-white mb-3 leading-snug">{t.theme}</h4>
                  <p className="text-xs text-white/30 leading-relaxed mb-4">{t.rationale}</p>
                  <div className="flex flex-wrap gap-1.5 mb-4">
                    {t.supporting_sectors.slice(0, 3).map((sec) => (
                      <span key={sec} className="text-[10px] px-2 py-0.5 border border-white/[0.06] text-white/25 tracking-wide">{sec}</span>
                    ))}
                  </div>
                  {t.watchlist && t.watchlist.length > 0 && (
                    <div>
                      <p className="text-[9px] tracking-widest uppercase text-white/20 mb-1.5">Watchlist</p>
                      <div className="space-y-0.5">
                        {t.watchlist.slice(0, 3).map((w) => (
                          <div key={w.name} className="flex items-center justify-between text-[11px]">
                            <span className="text-white/45 truncate">{w.name}</span>
                            <span className="text-white/25 tabular-nums ml-2">{w.score}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : suggestions && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-0 border border-white/[0.06]">
              {suggestions.suggestions.slice(0, 3).map((s, i) => (
                <div
                  key={i}
                  className={`p-7 ${i < 2 ? 'border-r border-white/[0.06]' : ''}`}
                  style={{ background: 'var(--surface-card)' }}
                >
                  <div className="flex items-start justify-between mb-4">
                    <span className={`text-[10px] tracking-widest uppercase px-2 py-1 border ${
                      s.risk_level === 'Low' ? 'border-green-400/30 text-green-400' :
                      s.risk_level === 'Medium' ? 'border-amber-400/30 text-amber-400' :
                      'border-red-400/30 text-red-400'
                    }`}>{s.risk_level} risk</span>
                  </div>
                  <h4 className="text-base font-thin text-white mb-3 leading-snug">{s.theme}</h4>
                  <p className="text-xs text-white/30 leading-relaxed mb-4">{s.rationale}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {s.supporting_sectors.slice(0, 3).map((sec) => (
                      <span key={sec} className="text-[10px] px-2 py-0.5 border border-white/[0.06] text-white/25 tracking-wide">{sec}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Layout>
  )
}

function fmtUpdated(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  } catch {
    return iso
  }
}
