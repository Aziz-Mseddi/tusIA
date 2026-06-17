import { useState, useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient, type UseMutationResult } from '@tanstack/react-query'
import {
  Upload, Users, TrendingUp, CheckCircle2, AlertTriangle,
  XCircle, Send, Sparkles, ArrowRight, RotateCcw, Globe, Flag, BarChart3, Shield, ChevronDown,
  History, Trash2, X,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { Layout } from '../../components/layout/Layout'
import { FileDropzone } from '../../components/ui/FileDropzone'
import { ScoreRing, PillarBar } from '../../components/startup/ScoreRing'
import { Badge, GradeBadge, ZoneBadge, RiskBadge } from '../../components/ui/Badge'
import { Spinner } from '../../components/ui/Spinner'
import { AIAvatar, ThinkingDots } from '../../components/ui/AIAvatar'
import { mode2Api } from '../../api/mode2'
import type {
  StartupProfile, FindAnaloguesResponse, ViabilityVerdict, AnaloguesSummary, Startup,
  FounderQuestionsResponse, FindAnaloguesBatchResponse, MultiViabilityVerdict,
  Mode2AssessmentDetail, ExtractProfileResponse,
} from '../../types'
import { clsx } from 'clsx'

type Step = 1 | 2 | 3 | 4

const MODE2_DRAFT_KEY = 'tunis-ia-mode2-draft'
const MODE2_JOB_KEY = 'tunis-ia-mode2-job'

type Mode2JobType = 'extract' | 'verdict' | 'multi_verdict'

interface ActiveJob {
  jobId: number
  jobType: Mode2JobType
}

interface Mode2Draft {
  step: Step
  isMultiple: boolean
  profile: StartupProfile
  profiles: StartupProfile[]
  analogues: FindAnaloguesResponse | null
  multiAnalogues: FindAnaloguesBatchResponse | null
  verdict: ViabilityVerdict | null
  multiVerdict: MultiViabilityVerdict | null
  expandedProfileIdx: number | null
  filesProcessed: string[]
}

const EMPTY_DRAFT: Mode2Draft = {
  step: 1, isMultiple: false, profile: {}, profiles: [], analogues: null,
  multiAnalogues: null, verdict: null, multiVerdict: null, expandedProfileIdx: null, filesProcessed: [],
}

/**
 * Persist a partial draft update directly to localStorage, independent of component
 * state/lifecycle. A mutation's onSuccess can fire after the user has navigated away
 * (the component that called `mutate` is unmounted), in which case its state setters
 * are no-ops — this is the only way the result survives until the user comes back.
 */
function persistDraft(patch: Partial<Mode2Draft>) {
  let existing: Mode2Draft = EMPTY_DRAFT
  try {
    const raw = localStorage.getItem(MODE2_DRAFT_KEY)
    if (raw) existing = { ...existing, ...JSON.parse(raw) }
  } catch {
    // ignore corrupt draft
  }
  localStorage.setItem(MODE2_DRAFT_KEY, JSON.stringify({ ...existing, ...patch }))
}

const SECTORS = ['Fintech', 'Agritech', 'Edtech', 'Healthtech', 'E-commerce', 'Logistics', 'Cleantech', 'SaaS', 'Food & Beverage', 'Manufacturing', 'Retail', 'Tourism Tech']
const STAGES = ['creation', 'development', 'restructuring']
const MODELS = ['B2B', 'B2C', 'B2B2C', 'Marketplace']

const COUNTRY_CODES: Record<string, string> = {
  Morocco: 'MA', Egypt: 'EG', Senegal: 'SN', 'Ivory Coast': 'CI', Kenya: 'KE',
  Nigeria: 'NG', Ghana: 'GH', Jordan: 'JO', Lebanon: 'LB', Pakistan: 'PK',
  Bangladesh: 'BD', Vietnam: 'VN', Indonesia: 'ID', Ethiopia: 'ET', Cameroon: 'CM',
  Rwanda: 'RW', Tanzania: 'TZ', Mozambique: 'MZ', Uganda: 'UG', Zambia: 'ZM',
  Myanmar: 'MM', Iraq: 'IQ', 'South Africa': 'ZA', DRC: 'CD', Philippines: 'PH',
  'Sri Lanka': 'LK', Angola: 'AO', Tunisia: 'TN',
}

const THEME_LABELS: Record<string, string> = {
  market: 'Market',
  unit_economics: 'Unit Economics',
  moat: 'Moat',
  team: 'Team',
  regulatory: 'Regulatory',
}

const THEME_ICONS: Record<string, typeof Globe> = {
  market: Globe,
  unit_economics: TrendingUp,
  moat: Shield,
  team: Users,
  regulatory: AlertTriangle,
}

/** Build the AnaloguesSummary payload shared by the verdict and founder-questions endpoints. */
function buildAnaloguesSummary(analogues: FindAnaloguesResponse): AnaloguesSummary {
  return {
    total_analogues: analogues.total_analogues,
    countries_represented: analogues.countries_represented,
    success_rate_percent: analogues.success_rate_percent,
    failure_rate_percent: analogues.failure_rate_percent,
    top_failure_reasons: [],
    top_success_signals: [],
    countries: analogues.by_country.map((c) => c.country),
    avg_score_by_country: Object.fromEntries(analogues.by_country.map((c) => [c.country, c.avg_score])),
  }
}

function StepIndicator({ current, step, label }: { current: Step; step: Step; label: string }) {
  const done = current > step
  const active = current === step
  return (
    <div className={clsx('flex items-center gap-2', step < 4 ? 'flex-1' : '')}>
      <div className={clsx(
        'flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all',
        done ? 'bg-success text-white' : active ? 'bg-primary text-white shadow-glow-blue' : 'bg-white/10 text-text-muted'
      )}>
        {done ? <CheckCircle2 size={16} /> : step}
      </div>
      <span className={clsx(
        'text-sm font-medium hidden sm:inline',
        active ? 'text-text-primary' : done ? 'text-success' : 'text-text-muted'
      )}>{label}</span>
      {step < 4 && <div className={clsx('flex-1 h-px mx-2', current > step ? 'bg-success/50' : 'bg-white/10')} />}
    </div>
  )
}

function VerdictCard({ verdict }: { verdict: ViabilityVerdict }) {
  const config = {
    INVEST: { color: 'text-success', bg: 'bg-success/10 border-success/25', icon: CheckCircle2 },
    CAUTION: { color: 'text-warning', bg: 'bg-warning/10 border-warning/25', icon: AlertTriangle },
    AVOID: { color: 'text-danger', bg: 'bg-danger/10 border-danger/25', icon: XCircle },
  }[verdict.recommendation]

  return (
    <div className={clsx('rounded-2xl border p-6', config.bg)}>
      <div className="flex items-start gap-4">
        <div className={clsx('p-3 rounded-xl bg-white/5', config.color)}>
          <config.icon size={28} />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h3 className={clsx('text-2xl font-black', config.color)}>{verdict.recommendation}</h3>
            <span className="text-sm text-text-muted">Confidence: <span className="font-medium text-text-secondary">{verdict.confidence}</span></span>
          </div>
          <p className="text-3xl font-bold text-text-primary mt-1">
            {verdict.simulated_success_probability_percent}%
            <span className="text-sm font-normal text-text-muted ml-2">success probability</span>
          </p>
        </div>
      </div>

      <p className="text-sm text-text-secondary leading-relaxed mt-4">{verdict.explanation}</p>

      <div className="grid sm:grid-cols-2 gap-4 mt-5">
        <div>
          <p className="text-xs font-semibold text-success mb-2">Favorable Signals</p>
          <ul className="space-y-1.5">
            {verdict.favorable_signals.map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-text-secondary">
                <CheckCircle2 size={12} className="text-success mt-0.5 flex-shrink-0" />
                {s}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-xs font-semibold text-danger mb-2">Risk Factors</p>
          <ul className="space-y-1.5">
            {verdict.risk_factors.map((r, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-text-secondary">
                <AlertTriangle size={12} className="text-danger mt-0.5 flex-shrink-0" />
                {r}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {verdict.country_benchmark && (
        <div className="mt-4 p-3 bg-white/5 rounded-lg">
          <p className="text-xs font-medium text-text-primary">
            Benchmark: {verdict.country_benchmark}
            {(() => {
              const match = Object.keys(COUNTRY_CODES).find((c) => verdict.country_benchmark.includes(c))
              return match ? (
                <span className="ml-2 text-[10px] font-bold tracking-wider text-accent bg-accent/10 border border-accent/25 rounded px-1.5 py-0.5">
                  {COUNTRY_CODES[match]}
                </span>
              ) : null
            })()}
          </p>
          <p className="text-xs text-text-secondary mt-0.5">{verdict.country_benchmark_reason}</p>
        </div>
      )}
    </div>
  )
}

/** Read-only summary of a saved assessment, shown in the History drawer. */
function HistoryDetailView({ detail }: { detail: Mode2AssessmentDetail }) {
  if (detail.is_multiple) {
    const profiles = (detail.profile as StartupProfile[]) ?? []
    const analogues = detail.analogues as FindAnaloguesBatchResponse | null
    const verdict = detail.verdict as MultiViabilityVerdict | null
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {profiles.map((p, i) => (
            <Badge key={i} variant="info" size="sm">{p.name ?? `Startup ${i + 1}`}</Badge>
          ))}
        </div>

        {analogues?.results.map((r) => (
          <div key={r.profile_name} className="p-3 bg-white/[0.03] rounded-lg border border-white/[0.05] flex items-center justify-between flex-wrap gap-2">
            <p className="text-sm font-medium text-text-primary flex items-center gap-2">
              {r.profile_name}
              {r.profile_name === analogues.best_choice_name && <Badge variant="success" size="sm">Best choice</Badge>}
            </p>
            <div className="flex gap-3 text-xs text-text-muted">
              <span>{r.analogues.total_analogues} analogues</span>
              <span className="text-success font-medium">{r.success_rate_percent.toFixed(0)}% success</span>
              <span>Avg score {r.overall_avg_score.toFixed(0)}</span>
            </div>
          </div>
        ))}

        {verdict && (
          <>
            <div className="p-4 bg-white/[0.03] border border-accent/20 rounded-lg">
              <p className="text-xs font-semibold text-accent uppercase tracking-wide flex items-center gap-1.5">
                <Sparkles size={12} /> Best Choice
              </p>
              <p className="text-lg font-bold text-text-primary mt-1">{verdict.best_choice_name}</p>
              <p className="text-sm text-text-secondary mt-1">{verdict.best_choice_reason}</p>
            </div>
            {verdict.items.map((item) => (
              <div key={item.name}>
                <h4 className="text-sm font-semibold text-text-primary mb-2">{item.name}</h4>
                <VerdictCard verdict={item} />
              </div>
            ))}
          </>
        )}
      </div>
    )
  }

  const profile = detail.profile as StartupProfile
  const analogues = detail.analogues as FindAnaloguesResponse | null
  const verdict = detail.verdict as ViabilityVerdict | null
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium text-text-primary">{profile.name ?? 'Untitled startup'}</p>
        <p className="text-xs text-text-muted mt-0.5">
          {profile.sector}{profile.sub_sector ? ` · ${profile.sub_sector}` : ''}
        </p>
      </div>

      {analogues && (
        <div className="p-4 bg-white/[0.03] rounded-lg border border-white/[0.05]">
          <div className="flex gap-6 flex-wrap">
            <div className="text-center">
              <p className="text-xl font-bold text-text-primary">{analogues.total_analogues}</p>
              <p className="text-xs text-text-muted">Total</p>
            </div>
            <div className="text-center">
              <p className="text-xl font-bold text-success">{analogues.success_rate_percent.toFixed(0)}%</p>
              <p className="text-xs text-text-muted">Success rate</p>
            </div>
            <div className="text-center">
              <p className="text-xl font-bold text-danger">{analogues.failure_rate_percent.toFixed(0)}%</p>
              <p className="text-xs text-text-muted">Failure rate</p>
            </div>
            <div className="text-center">
              <p className="text-xl font-bold text-primary">{analogues.countries_represented}</p>
              <p className="text-xs text-text-muted">Countries</p>
            </div>
          </div>
        </div>
      )}

      {verdict && <VerdictCard verdict={verdict} />}
    </div>
  )
}

/** Renders the "Comparable Companies Found" summary, by-country analogue cards (with score
 *  breakdown + inline AI chat), and the "Questions for the Founder" panel for one profile. */
function AnaloguesSection({
  profile,
  analogues,
  expandedScoreId,
  setExpandedScoreId,
  explainTarget,
  setExplainTarget,
  explainQ,
  setExplainQ,
  explainAnswer,
  setExplainAnswer,
  explainMutation,
}: {
  profile: StartupProfile
  analogues: FindAnaloguesResponse
  expandedScoreId: number | null
  setExpandedScoreId: (id: number | null) => void
  explainTarget: Startup | null
  setExplainTarget: (s: Startup | null) => void
  explainQ: string
  setExplainQ: (q: string) => void
  explainAnswer: string
  setExplainAnswer: (a: string) => void
  explainMutation: UseMutationResult<{ answer: string; startup_id: number }, Error, { startup: Startup; q: string }>
}) {
  const [founderQuestions, setFounderQuestions] = useState<FounderQuestionsResponse | null>(null)

  const founderQuestionsMutation = useMutation({
    mutationFn: () => mode2Api.founderQuestions(profile, buildAnaloguesSummary(analogues)),
    onSuccess: (data) => setFounderQuestions(data),
    onError: () => toast.error('Question generation failed — is Ollama running?'),
  })

  return (
    <>
      {/* Summary */}
      <div className="glass-card p-5">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <h3 className="section-title">Comparable Companies Found</h3>
            {analogues.warning && (
              <p className="text-xs text-warning mt-1 flex items-center gap-1">
                <AlertTriangle size={12} /> {analogues.warning}
              </p>
            )}
          </div>
          <div className="flex gap-6">
            <div className="text-center">
              <p className="text-2xl font-bold text-text-primary">{analogues.total_analogues}</p>
              <p className="text-xs text-text-muted">Total</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-success">{analogues.success_rate_percent.toFixed(0)}%</p>
              <p className="text-xs text-text-muted">Success rate</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-danger">{analogues.failure_rate_percent.toFixed(0)}%</p>
              <p className="text-xs text-text-muted">Failure rate</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-primary">{analogues.countries_represented}</p>
              <p className="text-xs text-text-muted">Countries</p>
            </div>
          </div>
        </div>
      </div>

      {/* By country */}
      {analogues.by_country.map((country) => (
        <div key={country.country} className="glass-card p-5">
          <div className="flex items-center gap-3 mb-4">
            <div>
              <h4 className="font-semibold text-text-primary flex items-center gap-2">
                {country.country}
                {COUNTRY_CODES[country.country] && (
                  <span className="text-[10px] font-bold tracking-wider text-accent bg-accent/10 border border-accent/25 rounded px-1.5 py-0.5">
                    {COUNTRY_CODES[country.country]}
                  </span>
                )}
              </h4>
              <p className="text-xs text-text-muted">
                {country.count} companies · Avg score {country.avg_score.toFixed(0)} · {country.success_rate_percent.toFixed(0)}% success
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {country.startups.slice(0, 4).map((startup) => {
              const sr = startup.score_result
              const detailsOpen = expandedScoreId === startup.id
              const chatOpen = explainTarget?.id === startup.id
              const penaltyReasons = sr.notes?.penalty_reasons ?? []
              return (
                <div
                  key={startup.id}
                  className={clsx(
                    'flex flex-col gap-3 p-3 bg-white/[0.03] rounded-lg border border-white/[0.05]',
                    (detailsOpen || chatOpen) && 'sm:col-span-2'
                  )}
                >
                  <div className="flex items-center gap-3">
                    <ScoreRing score={sr.final_score} size={44} strokeWidth={5} grade={sr.grade} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-text-primary truncate">{startup.name}</p>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        <Badge variant={startup.exit_status === 'active' ? 'success' : startup.exit_status === 'failed' ? 'danger' : 'info'} size="sm">
                          {startup.exit_status}
                        </Badge>
                        <ZoneBadge zone={sr.decision_zone} />
                        <RiskBadge risk={sr.risk_level} />
                        {startup.failure_reason && (
                          <span className="text-[10px] text-danger">{startup.failure_reason}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => setExpandedScoreId(detailsOpen ? null : startup.id)}
                        className={clsx('btn-ghost text-xs p-1.5', detailsOpen && 'text-accent')}
                        title="Score breakdown"
                      >
                        <BarChart3 size={13} />
                      </button>
                      <button
                        onClick={() => {
                          if (chatOpen) {
                            setExplainTarget(null)
                          } else {
                            setExplainTarget(startup); setExplainAnswer(''); setExplainQ('')
                          }
                        }}
                        className={clsx('btn-ghost text-xs p-1.5', chatOpen && 'text-accent')}
                        title="Ask AI about this company"
                      >
                        <Sparkles size={13} />
                      </button>
                    </div>
                  </div>

                  {/* Score breakdown */}
                  {detailsOpen && (
                    <div className="pt-3 border-t border-white/[0.06] space-y-3 animate-fade-in">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3">
                        <PillarBar label="Growth" value={sr.pillars.execution} />
                        <PillarBar label="Market/Risk" value={sr.pillars.market} />
                        <PillarBar label="Financial" value={sr.pillars.financial} />
                        <PillarBar label="ESG" value={sr.pillars.external} />
                      </div>
                      <p className="text-xs text-text-muted">
                        Estimated ROI: <span className="text-text-secondary font-medium">{(sr.estimated_roi * 100).toFixed(1)}%</span>
                      </p>
                      {penaltyReasons.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-warning mb-1.5">Penalty notes</p>
                          <ul className="space-y-1">
                            {penaltyReasons.map((reason, i) => (
                              <li key={i} className="flex items-start gap-1.5 text-[11px] text-text-muted">
                                <AlertTriangle size={10} className="text-warning mt-0.5 flex-shrink-0" />
                                {reason}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Inline AI assistant */}
                  {chatOpen && (
                    <div className="pt-3 border-t border-white/[0.06] animate-fade-in">
                      <div className="flex items-center gap-2 mb-2">
                        <Sparkles size={14} className="text-accent" />
                        <h4 className="text-sm font-medium text-text-primary">Ask about {startup.name}</h4>
                      </div>
                      <div className="flex gap-2">
                        <input
                          value={explainQ}
                          onChange={(e) => setExplainQ(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && explainMutation.mutate({ startup, q: explainQ })}
                          placeholder="Why did this company succeed/fail? How does it compare?"
                          className="input-base flex-1"
                        />
                        <button
                          onClick={() => explainMutation.mutate({ startup, q: explainQ })}
                          disabled={!explainQ.trim() || explainMutation.isPending}
                          className="btn-primary flex-shrink-0"
                        >
                          {explainMutation.isPending ? <Spinner size="sm" /> : <Send size={14} />}
                        </button>
                      </div>
                      {explainMutation.isPending && (
                        <div className="mt-3 flex items-center gap-2.5">
                          <AIAvatar size={24} thinking />
                          <ThinkingDots label="Thinking" />
                        </div>
                      )}
                      {explainAnswer && (
                        <div className="mt-3 p-4 bg-accent/5 border border-accent/20 rounded-lg animate-msg-in">
                          <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap">{explainAnswer}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {/* Pitch Interrogation Agent: questions for the founder */}
      <div className="glass-card p-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <Shield size={16} className="text-accent" />
            <h3 className="section-title">Questions for the Founder</h3>
          </div>
          <button
            onClick={() => founderQuestionsMutation.mutate()}
            disabled={founderQuestionsMutation.isPending}
            className="btn-secondary text-sm"
          >
            {founderQuestionsMutation.isPending ? <Spinner size="sm" /> : <><Sparkles size={14} /> Generate Questions</>}
          </button>
        </div>

        {founderQuestionsMutation.isPending && (
          <div className="mt-4 flex items-center gap-2.5">
            <AIAvatar size={24} thinking />
            <ThinkingDots label="Analyzing gaps" />
          </div>
        )}

        {founderQuestions && (
          <div className="mt-4 space-y-5 animate-fade-in">
            {Object.entries(
              founderQuestions.questions.reduce<Record<string, typeof founderQuestions.questions>>((acc, q) => {
                (acc[q.theme] ??= []).push(q)
                return acc
              }, {})
            ).map(([theme, questions]) => {
              const ThemeIcon = THEME_ICONS[theme] ?? Shield
              return (
                <div key={theme}>
                  <div className="flex items-center gap-2 mb-2">
                    <ThemeIcon size={14} className="text-text-muted" />
                    <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
                      {THEME_LABELS[theme] ?? theme}
                    </p>
                  </div>
                  <div className="space-y-3">
                    {questions.map((q, i) => (
                      <div key={i} className="p-3 bg-white/[0.03] rounded-lg border border-white/[0.05]">
                        <p className="text-sm font-medium text-text-primary">{q.question}</p>
                        <p className="text-[11px] text-text-muted mt-1.5">
                          <span className="font-semibold text-text-secondary">Gap: </span>{q.gap}
                        </p>
                        <p className="text-[11px] text-accent mt-1">
                          <span className="font-semibold">Why this matters: </span>{q.why_it_matters}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}

export default function Mode2Page() {
  const [step, setStep] = useState<Step>(1)
  const [files, setFiles] = useState<File[]>([])
  const [profile, setProfile] = useState<StartupProfile>({})
  const [analogues, setAnalogues] = useState<FindAnaloguesResponse | null>(null)
  const [verdict, setVerdict] = useState<ViabilityVerdict | null>(null)
  const [explainTarget, setExplainTarget] = useState<Startup | null>(null)
  const [explainQ, setExplainQ] = useState('')
  const [explainAnswer, setExplainAnswer] = useState('')
  const [expandedScoreId, setExpandedScoreId] = useState<number | null>(null)
  const [isMultiple, setIsMultiple] = useState(false)
  const [profiles, setProfiles] = useState<StartupProfile[]>([])
  const [multiAnalogues, setMultiAnalogues] = useState<FindAnaloguesBatchResponse | null>(null)
  const [multiVerdict, setMultiVerdict] = useState<MultiViabilityVerdict | null>(null)
  const [expandedProfileIdx, setExpandedProfileIdx] = useState<number | null>(0)
  const [filesProcessed, setFilesProcessed] = useState<string[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [viewingAssessment, setViewingAssessment] = useState<Mode2AssessmentDetail | null>(null)
  const [activeJob, setActiveJob] = useState<ActiveJob | null>(null)

  const queryClient = useQueryClient()
  const skipNextSaveRef = useRef(true)

  // Restore an in-progress assessment (if the user navigated away mid-flow) on mount.
  useEffect(() => {
    const raw = localStorage.getItem(MODE2_DRAFT_KEY)
    if (raw) {
      try {
        const draft = JSON.parse(raw) as Mode2Draft
        const hasProgress = draft.step > 1 || (draft.isMultiple && draft.profiles?.length > 0)
        if (hasProgress) {
          setStep(draft.step)
          setIsMultiple(draft.isMultiple)
          setProfile(draft.profile ?? {})
          setProfiles(draft.profiles ?? [])
          setAnalogues(draft.analogues ?? null)
          setMultiAnalogues(draft.multiAnalogues ?? null)
          setVerdict(draft.verdict ?? null)
          setMultiVerdict(draft.multiVerdict ?? null)
          setExpandedProfileIdx(draft.expandedProfileIdx ?? 0)
          setFilesProcessed(draft.filesProcessed ?? [])

          // Left mid-extraction for the multi-startup flow before analogues finished — resume that step.
          if (draft.isMultiple && draft.profiles?.length > 0 && !draft.multiAnalogues) {
            toast.success('Resuming your in-progress assessment — finding analogues...')
            multiAnaloguesMutation.mutate(draft.profiles)
          } else {
            toast.success(`Resumed your in-progress assessment (step ${draft.step} of 4)`)
          }
        }
      } catch {
        localStorage.removeItem(MODE2_DRAFT_KEY)
      }
    }
    skipNextSaveRef.current = false

    // Resume a background job (extract/verdict) that was still running when the
    // page was last closed/refreshed — independent of draft progress, since a job
    // started on step 1 has no draft yet.
    const rawJob = localStorage.getItem(MODE2_JOB_KEY)
    if (rawJob) {
      try {
        const job = JSON.parse(rawJob) as ActiveJob
        if (job?.jobId && job?.jobType) {
          setActiveJob(job)
          toast.success('Resuming background processing...')
        }
      } catch {
        localStorage.removeItem(MODE2_JOB_KEY)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep the in-progress assessment saved so it survives navigating to another page.
  useEffect(() => {
    if (skipNextSaveRef.current) return
    const hasProgress = step > 1 || (isMultiple && profiles.length > 0)
    if (!hasProgress) {
      localStorage.removeItem(MODE2_DRAFT_KEY)
      return
    }
    const draft: Mode2Draft = {
      step, isMultiple, profile, profiles, analogues, multiAnalogues,
      verdict, multiVerdict, expandedProfileIdx, filesProcessed,
    }
    localStorage.setItem(MODE2_DRAFT_KEY, JSON.stringify(draft))
  }, [step, isMultiple, profile, profiles, analogues, multiAnalogues, verdict, multiVerdict, expandedProfileIdx, filesProcessed])

  const extractMutation = useMutation({
    mutationFn: () => mode2Api.extractProfile(files),
    onSuccess: (data) => {
      const job: ActiveJob = { jobId: data.job_id, jobType: 'extract' }
      setActiveJob(job)
      localStorage.setItem(MODE2_JOB_KEY, JSON.stringify(job))
      toast.success('Processing in background — feel free to navigate away or refresh.')
    },
    onError: () => toast.error('Extraction failed — is Ollama running?'),
  })

  const analoguesMutation = useMutation({
    mutationFn: () => mode2Api.findAnalogues(profile),
    onSuccess: (data) => {
      setAnalogues(data)
      persistDraft({ step: 3, analogues: data })
      toast.success(`Found ${data.total_analogues} analogues`)
      setStep(3)
    },
    onError: () => toast.error('Failed to find analogues'),
  })

  const verdictMutation = useMutation({
    mutationFn: () => {
      if (!analogues) throw new Error()
      return mode2Api.viabilityVerdict(profile, buildAnaloguesSummary(analogues))
    },
    onSuccess: (data) => {
      const job: ActiveJob = { jobId: data.job_id, jobType: 'verdict' }
      setActiveJob(job)
      localStorage.setItem(MODE2_JOB_KEY, JSON.stringify(job))
      toast.success('Processing in background — feel free to navigate away or refresh.')
    },
    onError: () => toast.error('Verdict failed — is Ollama running?'),
  })

  const explainMutation = useMutation({
    mutationFn: ({ startup, q }: { startup: Startup; q: string }) =>
      mode2Api.explainAnalogue(startup.id, q, JSON.stringify(profile)),
    onSuccess: (data) => setExplainAnswer(data.answer),
    onError: () => toast.error('Explain failed — is Ollama running?'),
  })

  const multiAnaloguesMutation = useMutation({
    mutationFn: (extractedProfiles: StartupProfile[]) => mode2Api.findAnaloguesBatch(extractedProfiles),
    onSuccess: (data, extractedProfiles) => {
      setMultiAnalogues(data)
      setExpandedProfileIdx(0)
      setStep(3)
      persistDraft({ step: 3, isMultiple: true, profiles: extractedProfiles, multiAnalogues: data, expandedProfileIdx: 0 })
    },
    onError: () => toast.error('Failed to find analogues'),
  })

  const multiVerdictMutation = useMutation({
    mutationFn: () => {
      if (!multiAnalogues) throw new Error()
      const items = profiles.map((p, i) => ({
        name: multiAnalogues.results[i]?.profile_name ?? p.name ?? `Startup ${i + 1}`,
        profile: p,
        analogues_summary: buildAnaloguesSummary(multiAnalogues.results[i].analogues),
      }))
      return mode2Api.viabilityVerdictBatch(items)
    },
    onSuccess: (data) => {
      const job: ActiveJob = { jobId: data.job_id, jobType: 'multi_verdict' }
      setActiveJob(job)
      localStorage.setItem(MODE2_JOB_KEY, JSON.stringify(job))
      toast.success('Processing in background — feel free to navigate away or refresh.')
    },
    onError: () => toast.error('Verdict failed — is Ollama running?'),
  })

  // Poll the active background job (extract / verdict / multi-verdict) until it
  // completes — this survives a hard page refresh since `activeJob` is restored
  // from localStorage on mount.
  const jobQuery = useQuery({
    queryKey: ['mode2-job', activeJob?.jobId],
    queryFn: () => mode2Api.getJob(activeJob!.jobId),
    enabled: activeJob != null,
    refetchInterval: (q) => (q.state.data?.status === 'pending' ? 2000 : false),
  })

  useEffect(() => {
    if (!activeJob || !jobQuery.data) return
    const { status, result, error } = jobQuery.data
    if (status === 'pending') return

    if (status === 'error') {
      toast.error(`${error ?? 'Job failed'} — is Ollama running?`)
      setActiveJob(null)
      localStorage.removeItem(MODE2_JOB_KEY)
      return
    }

    if (activeJob.jobType === 'extract') {
      const data = result as ExtractProfileResponse
      if (data.error) {
        toast.error(data.error)
      } else {
        setFilesProcessed(data.files_processed)
        if (data.is_multiple) {
          setIsMultiple(true)
          setProfiles(data.extracted_profiles)
          persistDraft({ isMultiple: true, profiles: data.extracted_profiles, filesProcessed: data.files_processed })
          toast.success(`Detected ${data.extracted_profiles.length} startups — finding analogues...`)
          multiAnaloguesMutation.mutate(data.extracted_profiles)
        } else {
          setIsMultiple(false)
          setProfile(data.extracted_profiles[0] ?? {})
          persistDraft({ step: 2, isMultiple: false, profile: data.extracted_profiles[0] ?? {}, filesProcessed: data.files_processed })
          toast.success('Profile extracted successfully')
          setStep(2)
        }
      }
    } else if (activeJob.jobType === 'verdict') {
      const data = result as ViabilityVerdict
      setVerdict(data)
      persistDraft({ step: 4, verdict: data })
      setStep(4)
      mode2Api.saveAssessment({
        is_multiple: false,
        profile,
        analogues,
        verdict: data,
        source_filenames: filesProcessed,
      }).then(() => queryClient.invalidateQueries({ queryKey: ['mode2-assessments'] })).catch(() => {})
    } else if (activeJob.jobType === 'multi_verdict') {
      const data = result as MultiViabilityVerdict
      setMultiVerdict(data)
      persistDraft({ step: 4, multiVerdict: data })
      setStep(4)
      mode2Api.saveAssessment({
        is_multiple: true,
        profile: profiles,
        analogues: multiAnalogues,
        verdict: data,
        source_filenames: filesProcessed,
      }).then(() => queryClient.invalidateQueries({ queryKey: ['mode2-assessments'] })).catch(() => {})
    }

    setActiveJob(null)
    localStorage.removeItem(MODE2_JOB_KEY)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJob, jobQuery.data])

  const historyQuery = useQuery({
    queryKey: ['mode2-assessments'],
    queryFn: () => mode2Api.listAssessments(),
    enabled: historyOpen,
  })

  const viewAssessmentMutation = useMutation({
    mutationFn: (id: number) => mode2Api.getAssessment(id),
    onSuccess: (data) => setViewingAssessment(data),
    onError: () => toast.error('Failed to load assessment'),
  })

  const deleteAssessmentMutation = useMutation({
    mutationFn: (id: number) => mode2Api.deleteAssessment(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ['mode2-assessments'] })
      if (viewingAssessment?.id === id) setViewingAssessment(null)
    },
    onError: () => toast.error('Failed to delete assessment'),
  })

  function reset() {
    setStep(1); setFiles([]); setProfile({}); setAnalogues(null); setVerdict(null)
    setIsMultiple(false); setProfiles([]); setMultiAnalogues(null); setMultiVerdict(null); setExpandedProfileIdx(0)
    setFilesProcessed([])
    setActiveJob(null)
    localStorage.removeItem(MODE2_DRAFT_KEY)
    localStorage.removeItem(MODE2_JOB_KEY)
  }

  return (
    <Layout title="Viability Assessment">
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="page-title">Startup Viability Assessment</h2>
          <p className="text-sm text-text-muted mt-1">Upload documents, find analogues, and get an AI-powered investment verdict</p>
        </div>
        <button onClick={() => setHistoryOpen(true)} className="btn-secondary text-sm">
          <History size={14} /> History
        </button>
      </div>

      {/* History drawer */}
      {historyOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => { setHistoryOpen(false); setViewingAssessment(null) }}
          />
          <div className="relative w-full max-w-lg h-full bg-surface border-l border-white/10 overflow-y-auto p-5 animate-slide-up">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 min-w-0">
                {viewingAssessment && (
                  <button onClick={() => setViewingAssessment(null)} className="btn-ghost p-1.5 flex-shrink-0">
                    <ArrowRight size={16} className="rotate-180" />
                  </button>
                )}
                <h3 className="section-title truncate">{viewingAssessment ? viewingAssessment.title : 'Assessment History'}</h3>
              </div>
              <button
                onClick={() => { setHistoryOpen(false); setViewingAssessment(null) }}
                className="btn-ghost p-1.5 flex-shrink-0"
              >
                <X size={16} />
              </button>
            </div>

            {!viewingAssessment && (
              <>
                {historyQuery.isLoading && (
                  <div className="flex justify-center py-8"><Spinner /></div>
                )}
                {historyQuery.data && historyQuery.data.length === 0 && (
                  <p className="text-sm text-text-muted">No saved assessments yet — completed verdicts are saved here automatically.</p>
                )}
                <div className="space-y-2">
                  {historyQuery.data?.map((a) => (
                    <div key={a.id} className="p-3 bg-white/[0.03] rounded-lg border border-white/[0.05] flex items-center justify-between gap-2">
                      <button onClick={() => viewAssessmentMutation.mutate(a.id)} className="text-left flex-1 min-w-0">
                        <p className="text-sm font-medium text-text-primary truncate">{a.title}</p>
                        <p className="text-xs text-text-muted mt-0.5">{new Date(a.created_at).toLocaleString()}</p>
                        {a.headline && <p className="text-xs text-accent mt-1">{a.headline}</p>}
                      </button>
                      <button
                        onClick={() => deleteAssessmentMutation.mutate(a.id)}
                        className="btn-ghost p-1.5 text-danger flex-shrink-0"
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}

            {viewAssessmentMutation.isPending && (
              <div className="flex justify-center py-8"><Spinner /></div>
            )}

            {viewingAssessment && <HistoryDetailView detail={viewingAssessment} />}
          </div>
        </div>
      )}

      {/* Step Indicator */}
      <div className="glass-card p-5 mb-6">
        <div className="flex items-center">
          <StepIndicator current={step} step={1} label="Extract Profile" />
          <StepIndicator current={step} step={2} label="Review & Analogues" />
          <StepIndicator current={step} step={3} label="Analogues" />
          <StepIndicator current={step} step={4} label="Verdict" />
        </div>
      </div>

      {/* Step 1: Upload */}
      {step === 1 && (
        <div className="max-w-2xl mx-auto space-y-5 animate-slide-up">
          <div className="glass-card p-6">
            <h3 className="section-title mb-1">Upload Startup Documents</h3>
            <p className="text-sm text-text-muted mb-4">Upload PDF, TXT, or MD files — business plans, pitch decks, executive summaries</p>
            <FileDropzone
              onFiles={(f) => setFiles((prev) => [...prev, ...f])}
              files={files}
              multiple
              onRemove={(i) => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
            />
            <div className="flex justify-between mt-5">
              <p className="text-xs text-text-muted">{files.length} file(s) selected</p>
              <button
                onClick={() => extractMutation.mutate()}
                disabled={files.length === 0 || extractMutation.isPending || activeJob?.jobType === 'extract'}
                className="btn-primary"
              >
                {extractMutation.isPending || activeJob?.jobType === 'extract'
                  ? <><Spinner size="sm" /> Extracting...</>
                  : <><Sparkles size={15} /> Extract Profile</>}
              </button>
            </div>
            {activeJob?.jobType === 'extract' && (
              <p className="text-xs text-text-muted mt-3">
                Running in the background — feel free to navigate away or refresh this page.
              </p>
            )}
          </div>

          <div className="glass-card p-5">
            <p className="text-sm font-medium text-text-secondary mb-2">Or enter profile manually →</p>
            <button onClick={() => setStep(2)} className="btn-secondary text-sm">
              Enter Profile Manually <ArrowRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Review Profile */}
      {step === 2 && (
        <div className="animate-slide-up space-y-5">
          <div className="glass-card p-6">
            <h3 className="section-title mb-4">Review Extracted Profile</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label-base">Startup Name</label>
                <input value={profile.name ?? ''} onChange={(e) => setProfile({ ...profile, name: e.target.value })} className="input-base" placeholder="e.g., TechStart TN" />
              </div>
              <div>
                <label className="label-base">Sector</label>
                <select value={profile.sector ?? ''} onChange={(e) => setProfile({ ...profile, sector: e.target.value })} className="input-base bg-surface">
                  <option value="">Select sector...</option>
                  {SECTORS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="label-base">Sub-sector</label>
                <input value={profile.sub_sector ?? ''} onChange={(e) => setProfile({ ...profile, sub_sector: e.target.value })} className="input-base" placeholder="e.g., Mobile Payments" />
              </div>
              <div>
                <label className="label-base">Stage</label>
                <select value={profile.stage ?? ''} onChange={(e) => setProfile({ ...profile, stage: e.target.value })} className="input-base bg-surface">
                  <option value="">Select stage...</option>
                  {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="label-base">Business Model</label>
                <select value={profile.business_model ?? ''} onChange={(e) => setProfile({ ...profile, business_model: e.target.value })} className="input-base bg-surface">
                  <option value="">Select model...</option>
                  {MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="label-base">Tech-Enabled</label>
                <select
                  value={profile.tech_enabled == null ? '' : profile.tech_enabled ? 'true' : 'false'}
                  onChange={(e) => setProfile({ ...profile, tech_enabled: e.target.value === '' ? undefined : e.target.value === 'true' })}
                  className="input-base bg-surface"
                >
                  <option value="">Unknown</option>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </div>
              <div>
                <label className="label-base">Est. Employees</label>
                <input type="number" value={profile.employees_estimate ?? ''} onChange={(e) => setProfile({ ...profile, employees_estimate: e.target.value ? +e.target.value : undefined })} className="input-base" placeholder="e.g., 50" />
              </div>
              <div>
                <label className="label-base">Est. Revenue (USD)</label>
                <input type="number" value={profile.revenue_estimate_usd ?? ''} onChange={(e) => setProfile({ ...profile, revenue_estimate_usd: e.target.value ? +e.target.value : undefined })} className="input-base" placeholder="e.g., 500000" />
              </div>
              <div>
                <label className="label-base">Target Market</label>
                <input value={profile.target_market ?? ''} onChange={(e) => setProfile({ ...profile, target_market: e.target.value })} className="input-base" placeholder="e.g., SMEs in North Africa" />
              </div>
              <div>
                <label className="label-base">Key Product</label>
                <input value={profile.key_product ?? ''} onChange={(e) => setProfile({ ...profile, key_product: e.target.value })} className="input-base" placeholder="e.g., B2B SaaS platform" />
              </div>
              <div className="sm:col-span-2">
                <label className="label-base">Description</label>
                <textarea
                  value={profile.description ?? ''}
                  onChange={(e) => setProfile({ ...profile, description: e.target.value })}
                  className="input-base resize-none"
                  rows={3}
                  placeholder="Brief description of the startup..."
                />
              </div>
            </div>

            <div className="flex items-center justify-between mt-5 pt-4 border-t border-white/[0.06]">
              <button onClick={() => setStep(1)} className="btn-secondary">← Back</button>
              <button
                onClick={() => analoguesMutation.mutate()}
                disabled={analoguesMutation.isPending}
                className="btn-primary"
              >
                {analoguesMutation.isPending ? <Spinner size="sm" /> : <><Users size={15} /> Find Analogues</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 3: Analogues (single startup) */}
      {step === 3 && !isMultiple && analogues && (
        <div className="animate-slide-up space-y-5">
          <AnaloguesSection
            profile={profile}
            analogues={analogues}
            expandedScoreId={expandedScoreId}
            setExpandedScoreId={setExpandedScoreId}
            explainTarget={explainTarget}
            setExplainTarget={setExplainTarget}
            explainQ={explainQ}
            setExplainQ={setExplainQ}
            explainAnswer={explainAnswer}
            setExplainAnswer={setExplainAnswer}
            explainMutation={explainMutation}
          />

          <div className="flex items-center justify-between">
            <button onClick={() => setStep(2)} className="btn-secondary">← Back</button>
            <button
              onClick={() => verdictMutation.mutate()}
              disabled={verdictMutation.isPending || activeJob?.jobType === 'verdict'}
              className="btn-primary"
            >
              {verdictMutation.isPending || activeJob?.jobType === 'verdict'
                ? <><Spinner size="sm" /> Processing...</>
                : <><TrendingUp size={15} /> Get Viability Verdict</>}
            </button>
          </div>
          {activeJob?.jobType === 'verdict' && (
            <p className="text-xs text-text-muted text-right">
              Running in the background — feel free to navigate away or refresh this page.
            </p>
          )}
        </div>
      )}

      {/* Step 3: Analogues (multiple startups) */}
      {step === 3 && isMultiple && multiAnalogues && (
        <div className="animate-slide-up space-y-5">
          <div className="glass-card p-5">
            <h3 className="section-title mb-3">Comparable Companies Found</h3>
            {multiAnalogues.best_choice_name && (
              <div className="p-4 bg-accent/10 border border-accent/25 rounded-lg mb-4">
                <p className="text-xs font-semibold text-accent uppercase tracking-wide flex items-center gap-1.5">
                  <Sparkles size={12} /> Best Choice
                </p>
                <p className="text-lg font-bold text-text-primary mt-1">{multiAnalogues.best_choice_name}</p>
                <p className="text-sm text-text-secondary mt-1">{multiAnalogues.best_choice_reason}</p>
              </div>
            )}
            <div className="space-y-2">
              {multiAnalogues.results.map((r) => (
                <div key={r.profile_name} className="flex items-center justify-between flex-wrap gap-2 p-3 bg-white/[0.03] rounded-lg border border-white/[0.05]">
                  <p className="text-sm font-medium text-text-primary flex items-center gap-2">
                    {r.profile_name}
                    {r.profile_name === multiAnalogues.best_choice_name && <Badge variant="success" size="sm">Best choice</Badge>}
                  </p>
                  <div className="flex gap-4 text-xs text-text-muted">
                    <span>{r.analogues.total_analogues} analogues</span>
                    <span className="text-success font-medium">{r.success_rate_percent.toFixed(0)}% success</span>
                    <span>Avg score {r.overall_avg_score.toFixed(0)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {multiAnalogues.results.map((r, idx) => {
            const expanded = expandedProfileIdx === idx
            return (
              <div key={r.profile_name} className="glass-card p-5">
                <button
                  onClick={() => setExpandedProfileIdx(expanded ? null : idx)}
                  className="flex items-center justify-between w-full text-left"
                >
                  <h4 className="font-semibold text-text-primary">{r.profile_name}</h4>
                  <ChevronDown size={16} className={clsx('text-text-muted transition-transform', expanded && 'rotate-180')} />
                </button>
                {expanded && (
                  <div className="mt-4 space-y-5 animate-fade-in">
                    <AnaloguesSection
                      profile={profiles[idx] ?? {}}
                      analogues={r.analogues}
                      expandedScoreId={expandedScoreId}
                      setExpandedScoreId={setExpandedScoreId}
                      explainTarget={explainTarget}
                      setExplainTarget={setExplainTarget}
                      explainQ={explainQ}
                      setExplainQ={setExplainQ}
                      explainAnswer={explainAnswer}
                      setExplainAnswer={setExplainAnswer}
                      explainMutation={explainMutation}
                    />
                  </div>
                )}
              </div>
            )
          })}

          <div className="flex items-center justify-between">
            <button onClick={() => setStep(1)} className="btn-secondary">← Back</button>
            <button
              onClick={() => multiVerdictMutation.mutate()}
              disabled={multiVerdictMutation.isPending || activeJob?.jobType === 'multi_verdict'}
              className="btn-primary"
            >
              {multiVerdictMutation.isPending || activeJob?.jobType === 'multi_verdict'
                ? <><Spinner size="sm" /> Processing...</>
                : <><TrendingUp size={15} /> Get Viability Verdict</>}
            </button>
          </div>
          {activeJob?.jobType === 'multi_verdict' && (
            <p className="text-xs text-text-muted text-right">
              Running in the background — feel free to navigate away or refresh this page.
            </p>
          )}
        </div>
      )}

      {/* Step 4: Verdict (single startup) */}
      {step === 4 && !isMultiple && verdict && (
        <div className="animate-slide-up space-y-5">
          <VerdictCard verdict={verdict} />

          <div className="flex items-center justify-between">
            <button onClick={() => setStep(3)} className="btn-secondary">← View Analogues</button>
            <button onClick={reset} className="btn-secondary">
              <RotateCcw size={14} /> Start New Assessment
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Verdict (multiple startups) */}
      {step === 4 && isMultiple && multiVerdict && (
        <div className="animate-slide-up space-y-5">
          <div className="glass-card p-5 border border-accent/25">
            <p className="text-xs font-semibold text-accent uppercase tracking-wide flex items-center gap-1.5">
              <Sparkles size={12} /> Best Choice
            </p>
            <h3 className="text-2xl font-black text-text-primary mt-1">{multiVerdict.best_choice_name}</h3>
            <p className="text-sm text-text-secondary mt-2 leading-relaxed">{multiVerdict.best_choice_reason}</p>
          </div>

          {multiVerdict.items.map((item) => (
            <div key={item.name}>
              <h4 className="text-sm font-semibold text-text-primary mb-2 flex items-center gap-2">
                {item.name}
                {item.name === multiVerdict.best_choice_name && <Badge variant="success" size="sm">Best choice</Badge>}
              </h4>
              <VerdictCard verdict={item} />
            </div>
          ))}

          <div className="flex items-center justify-between">
            <button onClick={() => setStep(3)} className="btn-secondary">← View Analogues</button>
            <button onClick={reset} className="btn-secondary">
              <RotateCcw size={14} /> Start New Assessment
            </button>
          </div>
        </div>
      )}
    </Layout>
  )
}
