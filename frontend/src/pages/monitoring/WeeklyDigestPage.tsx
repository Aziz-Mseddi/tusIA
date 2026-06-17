import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Mail, MailCheck, ArrowRight, Sparkles, ShieldAlert, CalendarClock } from 'lucide-react'
import toast from 'react-hot-toast'
import { Layout } from '../../components/layout/Layout'
import { SeverityBadge } from '../../components/ui/Badge'
import { FullPageSpinner, Spinner } from '../../components/ui/Spinner'
import { monitoringApi } from '../../api/monitoring'
import { clsx } from 'clsx'

// Split a message into clean bullet points: explicit line breaks first, then
// sentence boundaries. Keeps each alert compact and scannable.
function toBullets(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=\.)\s+(?=[A-Z0-9"“])/))
    .map((s) => s.trim())
    .filter(Boolean)
}

function fmtRange(start: string, end: string) {
  try {
    const s = new Date(start), e = new Date(end)
    const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }
    return `${s.toLocaleDateString(undefined, opts)} – ${e.toLocaleDateString(undefined, { ...opts, year: 'numeric' })}`
  } catch {
    return `${start} – ${end}`
  }
}

export default function WeeklyDigestPage() {
  const qc = useQueryClient()
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())

  // 1s tick to drive the resend cooldown countdown.
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  const { data: listData, isLoading } = useQuery({
    queryKey: ['digests'],
    queryFn: monitoringApi.listDigests,
  })
  const digests = listData?.digests ?? []

  // Auto-select the most recent digest once the list loads.
  useEffect(() => {
    if (selectedId == null && digests.length > 0) setSelectedId(digests[0].id)
  }, [digests, selectedId])

  const { data: detail, isFetching: detailLoading } = useQuery({
    queryKey: ['digest', selectedId],
    queryFn: () => monitoringApi.getDigest(selectedId as number),
    enabled: selectedId != null,
  })

  // Per-investment alert breakdown is built and ranked server-side; cap each to 5.
  const investmentAlerts = detail?.investment_alerts ?? []

  const runNow = useMutation({
    mutationFn: monitoringApi.runDigestNow,
    onSuccess: (res) => {
      if (!res.digest) {
        toast.success(res.message ?? 'No open signals this week.')
        return
      }
      toast.success(res.digest.source === 'fallback'
        ? 'Digest generated (offline template — AI unavailable)'
        : 'Fresh digest generated')
      setSelectedId(res.digest.id)
      qc.invalidateQueries({ queryKey: ['digests'] })
      qc.invalidateQueries({ queryKey: ['digest', res.digest.id] })
    },
    onError: () => toast.error('Could not generate digest'),
  })

  const resendEmail = useMutation({
    mutationFn: (id: number) => monitoringApi.resendDigestEmail(id),
    onSuccess: (res) => {
      if (res.sent) {
        toast.success('Email sent')
      } else if (res.reason === 'cooldown') {
        toast.error(`Wait ${res.retry_after ?? 60}s before resending`)
      } else if (res.reason === 'duplicate') {
        toast.error('Already sent twice this week — content unchanged')
      } else {
        toast.error('Email seam inactive (SMTP not configured) — check backend logs')
      }
      if (selectedId != null) qc.invalidateQueries({ queryKey: ['digest', selectedId] })
    },
    onError: () => toast.error('Could not resend email'),
  })

  const markRead = useMutation({
    mutationFn: (id: number) => monitoringApi.markDigestRead(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['digests'] })
      if (selectedId != null) qc.invalidateQueries({ queryKey: ['digest', selectedId] })
    },
  })

  // Mark a digest read the moment its detail is opened.
  useEffect(() => {
    if (detail && !detail.read) markRead.mutate(detail.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.id])

  if (isLoading) return <FullPageSpinner />

  return (
    <Layout>
      {/* Header */}
      <div className="relative mb-12 pt-8 overflow-hidden">
        <div
          className="absolute top-0 left-0 right-0 leading-none font-thin text-white select-none pointer-events-none"
          style={{ fontSize: 'clamp(80px, 14vw, 180px)', opacity: 0.028, lineHeight: 0.85, letterSpacing: '-0.04em' }}
          aria-hidden
        >
          WATCHDOG
        </div>
        <div className="relative flex items-end justify-between gap-6">
          <div>
            <p className="text-[11px] tracking-[0.2em] uppercase text-white/25 mb-4">Portfolio Watchdog</p>
            <h1 className="text-4xl font-thin text-white leading-tight">This Week's <span className="text-gold">Action List</span></h1>
            <p className="text-sm text-white/30 mt-3 font-light">
              An autonomous weekly scan of your portfolio — clustered signals, prioritised by what needs you first.
            </p>
          </div>
          <button
            onClick={() => runNow.mutate()}
            disabled={runNow.isPending}
            className="flex-shrink-0 flex items-center gap-2 px-4 py-2.5 border border-gold/30 text-gold text-[11px] tracking-[0.18em] uppercase hover:bg-gold/10 transition-colors disabled:opacity-50"
          >
            {runNow.isPending ? <Spinner /> : <RefreshCw size={13} />}
            Run now
          </button>
        </div>
      </div>

      {digests.length === 0 ? (
        <div className="border border-white/[0.06] py-20 text-center" style={{ background: 'var(--surface-card)' }}>
          <Sparkles size={28} className="text-white/15 mx-auto mb-5" strokeWidth={1.2} />
          <p className="text-white/40 font-light">No digests yet.</p>
          <p className="text-white/25 text-sm mt-2 font-light">
            The watchdog runs every Monday. Hit <span className="text-gold">Run now</span> to generate this week's list on demand.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-0 border border-white/[0.06]">
          {/* Digest list */}
          <div className="border-b lg:border-b-0 lg:border-r border-white/[0.06]">
            {digests.map((d) => (
              <button
                key={d.id}
                onClick={() => setSelectedId(d.id)}
                className={clsx(
                  'w-full text-left px-5 py-4 border-b border-white/[0.04] transition-colors',
                  selectedId === d.id ? 'bg-white/[0.04]' : 'hover:bg-white/[0.02]',
                )}
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-[11px] tracking-widest uppercase text-white/30">
                    {fmtRange(d.period_start, d.period_end)}
                  </span>
                  {!d.read && <span className="w-1.5 h-1.5 rounded-full bg-gold flex-shrink-0" />}
                </div>
                <p className={clsx('text-sm leading-snug', selectedId === d.id ? 'text-white' : 'text-white/55')}>
                  {d.subject}
                </p>
                <div className="flex items-center gap-2 mt-2">
                  {(['CRITICAL', 'ALERT', 'WARNING'] as const).map((s) =>
                    d.stats[s] ? (
                      <span key={s} className="text-[10px] tracking-wide text-white/30">
                        {d.stats[s]} {s.toLowerCase()}
                      </span>
                    ) : null,
                  )}
                </div>
              </button>
            ))}
          </div>

          {/* Detail */}
          <div className="min-h-[400px]">
            {detailLoading || !detail ? (
              <div className="flex items-center justify-center h-full py-20"><Spinner /></div>
            ) : (
              <div className="p-7">
                <div className="flex items-center justify-between gap-4 mb-1">
                  <div className="flex items-center gap-2 text-[11px] tracking-widest uppercase text-white/30">
                    <Mail size={13} /> {fmtRange(detail.period_start, detail.period_end)}
                  </div>
                  <span className={clsx(
                    'text-[10px] tracking-widest uppercase px-2 py-0.5 border',
                    detail.source === 'fallback' ? 'border-white/15 text-white/35' : 'border-gold/30 text-gold/80',
                  )}>
                    {detail.source === 'fallback' ? 'Offline template' : 'AI-drafted'}
                  </span>
                </div>
                <h2 className="text-xl font-thin text-white mb-6 leading-snug">{detail.subject}</h2>

                {/* Prioritised todos */}
                <p className="text-[11px] tracking-[0.2em] uppercase text-white/25 mb-4 flex items-center gap-2">
                  <ShieldAlert size={13} /> Prioritised actions
                </p>
                <div className="space-y-8 mb-10">
                  {investmentAlerts.map((g, gi) => {
                    const hidden = g.total - 5
                    return (
                      <div key={g.investment_id}>
                        {/* Investment sub-section — ranked by urgency, most-urgent first */}
                        <div className="flex items-center gap-3 flex-wrap mb-3 pb-2 border-b border-white/[0.06]">
                          <span className="text-[11px] font-thin text-white/25 tabular-nums">
                            {String(gi + 1).padStart(2, '0')}
                          </span>
                          <SeverityBadge severity={g.severity} />
                          <Link
                            to={`/monitoring/${g.investment_id}`}
                            className="text-sm tracking-wide text-gold/80 hover:text-gold transition-colors flex items-center gap-1"
                          >
                            {g.investment_name} <ArrowRight size={11} />
                          </Link>
                          <span className="text-[10px] tracking-widest uppercase text-white/25 ml-auto">
                            {g.total} alert{g.total === 1 ? '' : 's'}
                          </span>
                        </div>

                        <div className="space-y-3">
                          {g.alerts.slice(0, 5).map((a, ai) => (
                            <div key={`${g.investment_id}-${ai}`} className="border border-white/[0.06] p-5" style={{ background: 'var(--surface-card)' }}>
                              <div className="flex items-start gap-4">
                                <span className="text-2xl font-thin text-white/20 leading-none w-8 flex-shrink-0">
                                  {String(ai + 1).padStart(2, '0')}
                                </span>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-3 flex-wrap mb-2">
                                    <SeverityBadge severity={a.severity} />
                                  </div>
                                  <ul className="space-y-1.5">
                                    {toBullets(a.message).map((point, pi) => (
                                      <li key={pi} className="flex gap-2.5 text-sm text-white/80 leading-relaxed">
                                        <span className="text-gold/60 select-none flex-shrink-0 leading-relaxed" aria-hidden>•</span>
                                        <span className="min-w-0">{point}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              </div>
                            </div>
                          ))}
                          {hidden > 0 && (
                            <p className="text-[11px] tracking-wide text-white/25 pl-12">
                              +{hidden} more alert{hidden === 1 ? '' : 's'} on this investment
                            </p>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Looking ahead — next week's heads-up deadlines, prioritised */}
                {(detail.heads_up_next_week ?? []).length > 0 && (
                  <>
                    <p className="text-[11px] tracking-[0.2em] uppercase text-white/25 mb-4 flex items-center gap-2">
                      <CalendarClock size={13} /> Looking ahead — next week
                    </p>
                    <div className="space-y-2 mb-10">
                      {(detail.heads_up_next_week ?? []).map((h, i) => (
                        <div key={i} className="border border-white/[0.06] p-4 flex items-start gap-3" style={{ background: 'var(--surface-card)' }}>
                          <SeverityBadge severity={h.severity} />
                          <div className="flex-1 min-w-0">
                            <ul className="space-y-1.5">
                              {toBullets(h.description).map((point, pi) => (
                                <li key={pi} className="flex gap-2.5 text-sm text-white/70 leading-snug">
                                  <span className="text-gold/60 select-none flex-shrink-0" aria-hidden>•</span>
                                  <span className="min-w-0">{point}</span>
                                </li>
                              ))}
                            </ul>
                            <p className="text-xs text-white/35 mt-1.5">
                              {h.investment_name} · Due {h.due_date}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {/* Drafted email */}
                <div className="flex items-center justify-between gap-4 mb-4">
                  <p className="text-[11px] tracking-[0.2em] uppercase text-white/25">Drafted email</p>
                  <div className="flex items-center gap-3">
                    {detail.email_sent_count > 0 && (
                      <span className="text-[10px] tracking-wide text-white/25">
                        Sent {detail.email_sent_count}x this week
                      </span>
                    )}
                    {(() => {
                      const remaining = detail.last_email_sent_at
                        ? Math.max(0, 60 - Math.floor((now - new Date(detail.last_email_sent_at).getTime()) / 1000))
                        : 0
                      return (
                        <button
                          onClick={() => resendEmail.mutate(detail.id)}
                          disabled={resendEmail.isPending || remaining > 0}
                          className="flex items-center gap-2 px-3 py-1.5 border border-gold/30 text-gold text-[11px] tracking-[0.18em] uppercase hover:bg-gold/10 transition-colors disabled:opacity-50"
                        >
                          {resendEmail.isPending ? <Spinner /> : <MailCheck size={13} />}
                          {remaining > 0 ? `Send again (${remaining}s)` : 'Send again'}
                        </button>
                      )
                    })()}
                  </div>
                </div>
                <div className="border border-white/[0.06] p-6" style={{ background: 'var(--surface-raised)' }}>
                  <pre className="whitespace-pre-wrap font-light text-sm text-white/55 leading-relaxed" style={{ fontFamily: 'inherit' }}>
                    {detail.body_markdown}
                  </pre>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </Layout>
  )
}
