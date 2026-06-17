import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import {
  ArrowLeft, MapPin, Users, Calendar, TrendingUp, Cpu, Building2,
  Globe, Leaf, Shield, Wifi, BarChart2, Send, Sparkles
} from 'lucide-react'
import toast from 'react-hot-toast'
import { Layout } from '../../components/layout/Layout'
import { ScoreRing, PillarBar } from '../../components/startup/ScoreRing'
import { GradeBadge, ZoneBadge, RiskBadge, Badge } from '../../components/ui/Badge'
import { FullPageSpinner, Spinner } from '../../components/ui/Spinner'
import { AIAvatar, ThinkingDots } from '../../components/ui/AIAvatar'
import { startupsApi } from '../../api/startups'
import { mode1Api } from '../../api/mode1'

function MetaRow({ icon: Icon, label, value }: { icon: any; label: string; value: string | number | boolean }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-white/[0.05] last:border-0">
      <div className="flex items-center gap-2 text-sm text-text-secondary">
        <Icon size={14} className="text-text-muted flex-shrink-0" />
        {label}
      </div>
      <span className="text-sm font-medium text-text-primary">{String(value)}</span>
    </div>
  )
}

export default function StartupDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')

  const { data: startup, isLoading } = useQuery({
    queryKey: ['startup', id],
    queryFn: () => startupsApi.get(Number(id)),
  })

  const explainMutation = useMutation({
    mutationFn: ({ q }: { q: string }) => mode1Api.explain(Number(id), q),
    onSuccess: (data) => setAnswer(data.answer),
    onError: () => toast.error('AI explain failed — is Ollama running?'),
  })

  if (isLoading) return <Layout title="Startup Detail"><FullPageSpinner /></Layout>
  if (!startup) return <Layout title="Not Found"><p className="text-text-muted">Startup not found.</p></Layout>

  const s = startup.score_result

  return (
    <Layout title={startup.name}>
      <div className="mb-5">
        <Link to="/mode1" className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary transition-colors">
          <ArrowLeft size={15} /> Back to Explorer
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Score & Details */}
        <div className="lg:col-span-1 space-y-4">
          {/* Score Card */}
          <div className="glass-card p-6 text-center">
            <ScoreRing score={s.final_score} size={120} strokeWidth={10} grade={s.grade} />
            <h2 className="text-xl font-bold text-text-primary mt-4">{startup.name}</h2>
            <div className="flex items-center justify-center gap-1.5 text-sm text-text-muted mt-1">
              <MapPin size={13} />
              <span>{startup.country}, {startup.region}</span>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2 mt-3">
              <GradeBadge grade={s.grade} />
              <ZoneBadge zone={s.decision_zone} />
              <RiskBadge risk={s.risk_level} />
            </div>

            <div className="grid grid-cols-2 gap-3 mt-5 pt-4 border-t border-white/[0.06]">
              <div className="text-center">
                <p className="text-xs text-text-muted">Est. ROI</p>
                <p className="text-lg font-bold text-success mt-0.5">{(s.estimated_roi * 100).toFixed(1)}%</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-text-muted">Risk Score</p>
                <p className="text-lg font-bold text-warning mt-0.5">{s.risk_total.toFixed(0)}/95</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-text-muted">Env. Factor</p>
                <p className="text-lg font-bold text-primary mt-0.5">{s.env_factor.toFixed(2)}x</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-text-muted">Raw Score</p>
                <p className="text-lg font-bold text-text-primary mt-0.5">{s.raw_score.toFixed(2)}</p>
              </div>
            </div>
          </div>

          {/* Pillars */}
          <div className="glass-card p-5">
            <h3 className="text-sm font-semibold text-text-primary mb-4">Score Pillars</h3>
            <div className="space-y-4">
              <PillarBar label="Growth (40%)" value={s.pillars.execution} />
              <PillarBar label="Risk (20%)" value={s.pillars.market} />
              <PillarBar label="Financial (30%)" value={s.pillars.financial} />
              <PillarBar label="ESG (10%)" value={s.pillars.external} />
            </div>
          </div>

          {/* Meta */}
          <div className="glass-card p-5">
            <h3 className="text-sm font-semibold text-text-primary mb-2">Company Info</h3>
            <div>
              <MetaRow icon={Building2} label="Sector" value={startup.sector} />
              {startup.sub_sector && <MetaRow icon={Building2} label="Sub-sector" value={startup.sub_sector} />}
              <MetaRow icon={TrendingUp} label="Stage" value={startup.stage} />
              <MetaRow icon={Globe} label="Business Model" value={startup.business_model} />
              <MetaRow icon={Cpu} label="Tech-Enabled" value={startup.tech_enabled ? 'Yes' : 'No'} />
              <MetaRow icon={Calendar} label="Founded" value={startup.founded_year} />
              <MetaRow icon={Users} label="Employees" value={startup.employees.toLocaleString()} />
              {startup.annual_revenue_usd != null && (
                <MetaRow icon={BarChart2} label="Revenue (USD)" value={`$${startup.annual_revenue_usd.toLocaleString()}`} />
              )}
              {startup.revenue_cagr_3y != null && (
                <MetaRow icon={TrendingUp} label="Revenue CAGR 3Y" value={`${startup.revenue_cagr_3y.toFixed(1)}%`} />
              )}
              {startup.ebitda_margin != null && (
                <MetaRow icon={BarChart2} label="EBITDA Margin" value={`${startup.ebitda_margin.toFixed(1)}%`} />
              )}
              {startup.esg_score != null && (
                <MetaRow icon={Leaf} label="ESG Score" value={`${startup.esg_score.toFixed(1)}/10`} />
              )}
              {startup.regulatory_stability != null && (
                <MetaRow icon={Shield} label="Regulatory" value={`${startup.regulatory_stability.toFixed(1)}/10`} />
              )}
            </div>
          </div>
        </div>

        {/* Right: Description, Tags & AI Explain */}
        <div className="lg:col-span-2 space-y-5">
          {/* Description */}
          {startup.description && (
            <div className="glass-card p-5">
              <h3 className="section-title mb-3">About</h3>
              <p className="text-sm text-text-secondary leading-relaxed">{startup.description}</p>
            </div>
          )}

          {/* Exit status & tags */}
          <div className="glass-card p-5">
            <h3 className="section-title mb-3">Status & Tags</h3>
            <div className="flex flex-wrap gap-2">
              <Badge variant={startup.exit_status === 'active' ? 'success' : startup.exit_status === 'failed' ? 'danger' : 'info'}>
                Exit: {startup.exit_status}
              </Badge>
              {startup.failure_reason && (
                <Badge variant="danger">Failure: {startup.failure_reason}</Badge>
              )}
              {startup.tags?.split(',').map((t) => t.trim()).filter(Boolean).map((tag) => (
                <Badge key={tag} variant="muted">{tag}</Badge>
              ))}
            </div>
          </div>

          {/* Financial Metrics */}
          <div className="glass-card p-5">
            <h3 className="section-title mb-4">Financial & Market Metrics</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {[
                { label: 'TAM', value: startup.total_addressable_market_M != null ? `$${startup.total_addressable_market_M}M` : null },
                { label: 'Market Growth', value: startup.market_growth_rate != null ? `${startup.market_growth_rate.toFixed(1)}%` : null },
                { label: 'Competition', value: startup.competition_intensity != null ? `${startup.competition_intensity.toFixed(1)}/10` : null },
                { label: 'Debt/EBITDA', value: startup.debt_to_ebitda != null ? `${startup.debt_to_ebitda.toFixed(1)}x` : null },
                { label: 'Current Ratio', value: startup.current_ratio != null ? `${startup.current_ratio.toFixed(2)}` : null },
                { label: 'Infrastructure', value: startup.local_infrastructure != null ? `${startup.local_infrastructure.toFixed(1)}/10` : null },
              ].filter((m) => m.value).map((m) => (
                <div key={m.label} className="p-3 bg-white/[0.03] rounded-lg border border-white/[0.05]">
                  <p className="text-xs text-text-muted">{m.label}</p>
                  <p className="text-base font-semibold text-text-primary mt-0.5">{m.value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* AI Explain */}
          <div className="glass-card p-5">
            <div className="flex items-center gap-2 mb-4">
              <Sparkles size={16} className="text-accent" />
              <h3 className="section-title">Ask AI About This Startup</h3>
            </div>
            <div className="flex gap-2 mb-4">
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !explainMutation.isPending && explainMutation.mutate({ q: question })}
                placeholder="e.g., Why is the score low? What drove the failure?"
                className="input-base flex-1"
              />
              <button
                onClick={() => explainMutation.mutate({ q: question })}
                disabled={explainMutation.isPending || !question.trim()}
                className="btn-primary flex-shrink-0"
              >
                {explainMutation.isPending ? <Spinner size="sm" /> : <Send size={15} />}
              </button>
            </div>

            <div className="flex flex-wrap gap-2 mb-4">
              {[
                'Why is this company\'s score low?',
                'What are the main risk factors?',
                'What signals indicate growth potential?',
                'Why did this company fail?',
              ].map((q) => (
                <button
                  key={q}
                  onClick={() => { setQuestion(q); explainMutation.mutate({ q }) }}
                  className="text-xs px-2.5 py-1 bg-white/5 hover:bg-white/10 text-text-muted hover:text-text-secondary border border-white/10 rounded-full transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>

            {explainMutation.isPending && (
              <div className="flex items-center gap-2.5 text-sm">
                <AIAvatar size={24} thinking />
                <ThinkingDots label="Analyzing" />
              </div>
            )}

            {answer && (
              <div className="p-4 bg-accent/5 border border-accent/20 rounded-xl animate-fade-in">
                <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap">{answer}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  )
}
