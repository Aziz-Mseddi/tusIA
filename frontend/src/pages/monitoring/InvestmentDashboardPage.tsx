import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Plus, Trash2, CheckCircle2, Clock, AlertTriangle,
  TrendingUp, DollarSign, FileText,
  RefreshCw, Shield, Flame, Sparkles, Edit3, CheckSquare
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend
} from 'recharts'
import toast from 'react-hot-toast'
import { Layout } from '../../components/layout/Layout'
import { Modal } from '../../components/ui/Modal'
import { FileDropzone } from '../../components/ui/FileDropzone'
import { SeverityBadge, StatusBadge, Badge } from '../../components/ui/Badge'
import { FullPageSpinner, Spinner } from '../../components/ui/Spinner'
import { UnifiedCalendar } from '../../components/monitoring/UnifiedCalendar'
import { AlertsTab } from './AlertsTab'
import { monitoringApi } from '../../api/monitoring'
import type { ContractClause, PlanMilestone, FundAllocation, Expenditure, MonitoringAlert } from '../../types'
import { FUND_FLOW_COLORS } from '../../utils/fundFlow'
import { clsx } from 'clsx'

type Tab = 'overview' | 'clauses' | 'milestones' | 'funds' | 'alerts' | 'calendar'
type UploadTarget = 'clauses' | 'milestones' | 'allocations' | 'liquidity_clauses'

const STATUS_OPTIONS = ['pending', 'in_progress', 'fulfilled', 'overdue']

const LIQUIDITY_CLAUSE_LABELS: Record<string, string> = {
  put_option: 'Put Option',
  drag_along: 'Drag-Along',
  tag_along: 'Tag-Along',
  ratchet: 'Ratchet',
}

function StatChip({ label, value, color = 'blue' }: { label: string; value: number; color?: string }) {
  const colors: Record<string, string> = {
    blue: 'text-gold bg-gold-dim',
    green: 'text-success bg-success/10',
    red: 'text-danger bg-danger/10',
    amber: 'text-warning bg-warning/10',
  }
  return (
    <div className="glass-card p-4 text-center">
      <p className={clsx('text-2xl font-black', colors[color].split(' ')[0])}>{value}</p>
      <p className="text-xs text-text-muted mt-0.5">{label}</p>
    </div>
  )
}

function ItemRow({
  item,
  onUpdate,
  onDelete,
  type,
}: {
  item: ContractClause | PlanMilestone
  onUpdate: (id: number, data: any) => void
  onDelete: (id: number) => void
  type: 'clause' | 'milestone'
}) {
  const [editing, setEditing] = useState(false)
  const [evidence, setEvidence] = useState(item.evidence_note ?? '')
  const [dueDate, setDueDate] = useState(item.due_date ?? '')
  const [desc, setDesc] = useState(item.description)

  function saveEdit() {
    onUpdate(item.id, { description: desc, evidence_note: evidence, due_date: dueDate || undefined })
    setEditing(false)
  }

  return (
    <div className={clsx(
      'p-4 rounded-xl border transition-colors',
      item.status === 'overdue' ? 'border-danger/25 bg-danger/5' :
      item.status === 'fulfilled' ? 'border-success/15 bg-success/5 opacity-70' :
      'border-white/[0.07] bg-white/[0.02]'
    )}>
      {editing ? (
        <div className="space-y-2">
          <textarea
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            className="input-base text-sm resize-none w-full"
            rows={2}
          />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label-base">Due Date</label>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="input-base text-sm" />
            </div>
            <div>
              <label className="label-base">Evidence Note</label>
              <input value={evidence} onChange={(e) => setEvidence(e.target.value)} className="input-base text-sm" placeholder="e.g., Document submitted on..." />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={saveEdit} className="btn-primary text-xs py-1.5">Save</button>
            <button onClick={() => setEditing(false)} className="btn-secondary text-xs py-1.5">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm text-text-primary leading-relaxed">{item.description}</p>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <StatusBadge status={item.status} />
              {item.due_date && (
                <span className="text-xs text-text-muted flex items-center gap-1">
                  <Clock size={10} /> {item.due_date}
                </span>
              )}
              {item.evidence_note && (
                <span className="text-xs text-success flex items-center gap-1">
                  <CheckCircle2 size={10} /> {item.evidence_note}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <select
              value={item.status}
              onChange={(e) => onUpdate(item.id, { status: e.target.value })}
              className="text-xs bg-surface border border-white/10 rounded-md px-2 py-1 text-text-secondary outline-none"
            >
              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
            </select>
            <button onClick={() => setEditing(true)} className="btn-ghost p-1.5"><Edit3 size={13} /></button>
            <button onClick={() => onDelete(item.id)} className="btn-ghost p-1.5 text-danger hover:bg-danger/10"><Trash2 size={13} /></button>
          </div>
        </div>
      )}
    </div>
  )
}

function DocumentExtractPanel({
  target,
  uploadTarget,
  setUploadTarget,
  uploadFile,
  setUploadFile,
  uploadMutation,
  dropLabel,
}: {
  target: UploadTarget
  uploadTarget: UploadTarget | null
  setUploadTarget: (t: UploadTarget | null) => void
  uploadFile: File | null
  setUploadFile: (f: File | null) => void
  uploadMutation: ReturnType<typeof useMutation<any, unknown, void>>
  dropLabel: string
}) {
  const open = uploadTarget === target
  return (
    <div className="glass-card p-4 border border-white/[0.06]">
      <button
        onClick={() => { setUploadTarget(open ? null : target); setUploadFile(null) }}
        className="flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
      >
        <Sparkles size={14} className="text-accent" />
        {open ? 'Hide AI extraction' : 'Or extract from a document with AI'}
      </button>
      {open && (
        <div className="mt-3 animate-fade-in">
          <FileDropzone
            onFiles={(f) => setUploadFile(f[0] ?? null)}
            files={uploadFile ? [uploadFile] : []}
            onRemove={() => setUploadFile(null)}
            label={dropLabel}
          />
          <div className="flex justify-end mt-3">
            <button
              onClick={() => uploadMutation.mutate()}
              disabled={!uploadFile || uploadMutation.isPending}
              className="btn-primary text-sm"
            >
              {uploadMutation.isPending ? <Spinner size="sm" /> : <><Sparkles size={14} /> Extract with AI</>}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function LiquidityClauseCard({
  clause,
  onDelete,
  onOpenExerciseLetter,
}: {
  clause: ContractClause
  onDelete: (id: number) => void
  onOpenExerciseLetter: (id: number) => void
}) {
  const numbers = clause.numbers
  return (
    <div className={clsx(
      'p-4 rounded-xl border transition-colors',
      clause.status === 'overdue' ? 'border-danger/25 bg-danger/5' :
      clause.status === 'fulfilled' ? 'border-success/15 bg-success/5 opacity-70' :
      'border-purple-400/20 bg-purple-500/5'
    )}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <span className="text-[11px] px-2 py-0.5 border border-purple-400/30 text-purple-400 tracking-wide">
              {LIQUIDITY_CLAUSE_LABELS[clause.clause_type] ?? clause.clause_type}
            </span>
            <StatusBadge status={clause.status} />
          </div>
          <p className="text-sm text-text-primary leading-relaxed">{clause.description}</p>
          {clause.trigger_condition && (
            <p className="text-xs text-text-muted mt-1.5"><span className="text-text-secondary">Trigger:</span> {clause.trigger_condition}</p>
          )}
          {clause.right_holder && (
            <p className="text-xs text-text-muted mt-0.5"><span className="text-text-secondary">Right holder:</span> {clause.right_holder}</p>
          )}
          <div className="flex flex-wrap items-center gap-2 mt-2">
            {clause.due_date && (
              <span className="text-xs text-text-muted flex items-center gap-1"><Clock size={10} /> Exercise window: {clause.due_date}</span>
            )}
            {numbers?.price != null && <span className="text-[11px] px-1.5 py-0.5 border border-white/10 text-text-secondary">Price: {numbers.price}</span>}
            {numbers?.share_count != null && <span className="text-[11px] px-1.5 py-0.5 border border-white/10 text-text-secondary">Shares: {numbers.share_count}</span>}
            {numbers?.threshold != null && <span className="text-[11px] px-1.5 py-0.5 border border-white/10 text-text-secondary">Threshold: {numbers.threshold}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={() => onOpenExerciseLetter(clause.id)} className="btn-secondary text-xs py-1.5 px-2 gap-1 whitespace-nowrap">
            <FileText size={12} /> Exercise Letter
          </button>
          <button onClick={() => onDelete(clause.id)} className="btn-ghost p-1.5 text-danger hover:bg-danger/10"><Trash2 size={13} /></button>
        </div>
      </div>
    </div>
  )
}

function ExerciseLetterModal({ clauseId, onClose }: { clauseId: number | null; onClose: () => void }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['exercise-letter', clauseId],
    queryFn: () => monitoringApi.getExerciseLetter(clauseId as number),
    enabled: clauseId != null,
  })

  async function downloadPdf() {
    if (clauseId == null) return
    try {
      const blob = await monitoringApi.downloadExerciseLetterPdf(clauseId)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `exercise_letter_clause_${clauseId}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Failed to generate PDF')
    }
  }

  return (
    <Modal open={clauseId != null} onClose={onClose} title="Exercise Letter (Draft)" size="lg">
      {isLoading ? (
        <div className="py-8 flex justify-center"><Spinner /></div>
      ) : isError || !data ? (
        <p className="text-text-muted text-sm">Failed to load draft.</p>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Badge variant={data.source === 'ollama' ? 'info' : 'muted'}>
              {data.source === 'ollama' ? 'AI-drafted' : 'Template fallback'}
            </Badge>
            <button onClick={downloadPdf} className="btn-secondary text-sm">Download PDF</button>
          </div>
          <pre className="whitespace-pre-wrap font-sans text-sm text-text-secondary bg-white/[0.02] border border-white/[0.06] p-4 rounded-lg max-h-[60vh] overflow-y-auto">
            {data.letter_markdown}
          </pre>
        </div>
      )}
    </Modal>
  )
}

export default function InvestmentDashboardPage() {
  const { id } = useParams<{ id: string }>()
  const invId = Number(id)
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('overview')

  const [addClauseOpen, setAddClauseOpen] = useState(false)
  const [addMilestoneOpen, setAddMilestoneOpen] = useState(false)
  const [addAllocOpen, setAddAllocOpen] = useState(false)
  const [addExpOpen, setAddExpOpen] = useState(false)

  const [clauseDesc, setClauseDesc] = useState('')
  const [clauseDue, setClauseDue] = useState('')
  const [msDesc, setMsDesc] = useState('')
  const [msDue, setMsDue] = useState('')
  const [allocCat, setAllocCat] = useState('')
  const [allocAmt, setAllocAmt] = useState('')
  const [expForm, setExpForm] = useState({ category: '', amount: '', description: '', date: new Date().toISOString().split('T')[0], has_receipt: false, vendor: '' })

  const [uploadTarget, setUploadTarget] = useState<UploadTarget | null>(null)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [exerciseLetterClauseId, setExerciseLetterClauseId] = useState<number | null>(null)

  const { data: dashboard, isLoading, refetch } = useQuery({
    queryKey: ['dashboard', invId],
    queryFn: () => monitoringApi.dashboard(invId),
    enabled: !!invId,
  })

  function inv() { qc.invalidateQueries({ queryKey: ['dashboard', invId] }) }

  const addClauseMutation = useMutation({
    mutationFn: () => monitoringApi.addClause(invId, clauseDesc, clauseDue || undefined),
    onSuccess: () => { inv(); setAddClauseOpen(false); setClauseDesc(''); setClauseDue('') },
    onError: () => toast.error('Failed to add clause'),
  })

  const updateClauseMutation = useMutation({
    mutationFn: ({ cid, data }: { cid: number; data: any }) => monitoringApi.updateClause(cid, data),
    onSuccess: inv,
  })

  const deleteClauseMutation = useMutation({
    mutationFn: (cid: number) => monitoringApi.deleteClause(cid),
    onSuccess: () => { inv(); toast.success('Clause deleted') },
  })

  const addMsMutation = useMutation({
    mutationFn: () => monitoringApi.addMilestone(invId, msDesc, msDue || undefined),
    onSuccess: () => { inv(); setAddMilestoneOpen(false); setMsDesc(''); setMsDue('') },
  })

  const updateMsMutation = useMutation({
    mutationFn: ({ mid, data }: { mid: number; data: any }) => monitoringApi.updateMilestone(mid, data),
    onSuccess: inv,
  })

  const deleteMsMutation = useMutation({
    mutationFn: (mid: number) => monitoringApi.deleteMilestone(mid),
    onSuccess: () => { inv(); toast.success('Milestone deleted') },
  })

  const addAllocMutation = useMutation({
    mutationFn: () => monitoringApi.addAllocation(invId, allocCat, Number(allocAmt)),
    onSuccess: () => { inv(); setAddAllocOpen(false); setAllocCat(''); setAllocAmt('') },
  })

  const deleteAllocMutation = useMutation({
    mutationFn: (aid: number) => monitoringApi.deleteAllocation(aid),
    onSuccess: () => { inv(); toast.success('Allocation deleted') },
  })

  const addExpMutation = useMutation({
    mutationFn: () => monitoringApi.addExpenditure(invId, {
      ...expForm,
      amount: Number(expForm.amount),
    }),
    onSuccess: () => { inv(); setAddExpOpen(false); setExpForm({ category: '', amount: '', description: '', date: new Date().toISOString().split('T')[0], has_receipt: false, vendor: '' }) },
  })

  const deleteExpMutation = useMutation({
    mutationFn: (eid: number) => monitoringApi.deleteExpenditure(eid),
    onSuccess: () => { inv(); toast.success('Expenditure deleted') },
  })

  const ackAlertMutation = useMutation({
    mutationFn: (alertId: number) => monitoringApi.acknowledgeAlert(alertId),
    onSuccess: inv,
  })

  const runChecksMutation = useMutation({
    mutationFn: () => monitoringApi.runChecks(invId),
    onSuccess: (d) => { inv(); toast.success(`${d.alerts.length} alerts generated`) },
  })

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!uploadFile || !uploadTarget) throw new Error()
      if (uploadTarget === 'clauses') return monitoringApi.extractClauses(invId, uploadFile)
      if (uploadTarget === 'milestones') return monitoringApi.extractMilestones(invId, uploadFile)
      if (uploadTarget === 'liquidity_clauses') return monitoringApi.extractLiquidityClauses(invId, uploadFile)
      return monitoringApi.extractAllocations(invId, uploadFile)
    },
    onSuccess: (data: any) => {
      inv()
      toast.success(`Extracted ${data.extracted_count} items`)
      setUploadTarget(null)
      setUploadFile(null)
    },
    onError: () => toast.error('Extraction failed — is Ollama running?'),
  })

  if (isLoading) return <Layout title="Investment Dashboard"><FullPageSpinner /></Layout>
  if (!dashboard) return <Layout title="Not Found"><p className="text-text-muted">Investment not found</p></Layout>

  const d = dashboard
  const st = d.stats

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'clauses', label: 'Clauses', badge: st.overdue_clauses > 0 ? st.overdue_clauses : undefined },
    { id: 'milestones', label: 'Milestones', badge: st.overdue_milestones > 0 ? st.overdue_milestones : undefined },
    { id: 'funds', label: 'Fund Flow' },
    { id: 'alerts', label: 'Alerts', badge: st.unacknowledged_alerts > 0 ? st.unacknowledged_alerts : undefined },
    { id: 'calendar', label: 'Calendar' },
  ]

  const liquidityClauses = d.clauses.filter((c) => c.clause_type !== 'obligation')
  const obligationClauses = d.clauses.filter((c) => c.clause_type === 'obligation')

  const fundFlowData = d.fund_flow.map((f) => ({
    name: f.category.length > 12 ? f.category.slice(0, 12) + '…' : f.category,
    fullName: f.category,
    Agreed: f.agreed,
    Actual: f.actual,
    status: f.status,
  }))

  return (
    <Layout title={d.investment.startup_name}>
      {/* Back + Header */}
      <div className="mb-5">
        <Link to="/monitoring" className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary transition-colors mb-3">
          <ArrowLeft size={14} /> Back to Investments
        </Link>
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-2xl font-bold text-text-primary">{d.investment.startup_name}</h2>
            <div className="flex items-center gap-3 mt-1 text-sm text-text-muted flex-wrap">
              <span className={clsx(
                'px-2 py-0.5 rounded-md border text-xs font-medium',
                d.investment.stage === 'restructuring' ? 'bg-amber-500/15 text-amber-400 border-amber-500/25' :
                d.investment.stage === 'creation' ? 'bg-blue-500/15 text-blue-400 border-blue-500/25' :
                'bg-emerald-500/15 text-emerald-400 border-emerald-500/25'
              )}>{d.investment.stage}</span>
              <span>{d.investment.contract_start_date} → {d.investment.contract_end_date}</span>
              {d.days_remaining != null && (
                <span className={clsx('font-medium', d.days_remaining < 30 ? 'text-danger' : d.days_remaining < 90 ? 'text-warning' : 'text-text-secondary')}>
                  {d.days_remaining} days remaining
                </span>
              )}
              {d.investment.total_amount_tnd != null && (
                <span>TND {d.investment.total_amount_tnd.toLocaleString()}</span>
              )}
            </div>
          </div>
          <button onClick={() => runChecksMutation.mutate()} disabled={runChecksMutation.isPending} className="btn-secondary text-sm">
            {runChecksMutation.isPending ? <Spinner size="sm" /> : <><RefreshCw size={13} /> Run Checks</>}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-white/[0.06] mb-6 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              'flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors',
              tab === t.id ? 'tab-active' : 'tab-inactive'
            )}
          >
            {t.label}
            {t.badge != null && (
              <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-danger/20 text-danger text-[10px] font-bold">
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {tab === 'overview' && (
        <div className="space-y-6 animate-fade-in">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatChip label="Total Clauses" value={st.total_clauses} color="blue" />
            <StatChip label="Fulfilled" value={st.fulfilled_clauses} color="green" />
            <StatChip label="Overdue" value={st.overdue_clauses} color="red" />
            <StatChip label="At-Risk" value={st.at_risk_clauses} color="amber" />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatChip label="Total Milestones" value={st.total_milestones} color="blue" />
            <StatChip label="Fulfilled" value={st.fulfilled_milestones} color="green" />
            <StatChip label="Overdue" value={st.overdue_milestones} color="red" />
            <StatChip label="Unread Alerts" value={st.unacknowledged_alerts} color="amber" />
          </div>

          {/* Fund summary */}
          {(st.total_agreed_tnd > 0 || st.total_actual_tnd > 0) && (
            <div className="glass-card p-5">
              <h3 className="section-title mb-4">Fund Summary</h3>
              <div className="grid grid-cols-3 gap-4">
                <div className="text-center">
                  <p className="text-xs text-text-muted">Total Agreed</p>
                  <p className="text-xl font-bold text-primary mt-1">{st.total_agreed_tnd.toLocaleString()} TND</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-text-muted">Total Spent</p>
                  <p className={clsx('text-xl font-bold mt-1', st.total_actual_tnd > st.total_agreed_tnd ? 'text-danger' : 'text-text-primary')}>
                    {st.total_actual_tnd.toLocaleString()} TND
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-text-muted">Unverified Spend</p>
                  <p className={clsx('text-xl font-bold mt-1', st.unverified_spend_tnd > 5000 ? 'text-warning' : 'text-text-primary')}>
                    {st.unverified_spend_tnd.toLocaleString()} TND
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* At-risk items */}
          {(d.at_risk.clauses.length > 0 || d.at_risk.milestones.length > 0) && (
            <div className="glass-card p-5 border border-warning/20">
              <h3 className="section-title flex items-center gap-2 mb-4">
                <AlertTriangle size={16} className="text-warning" /> At-Risk Items
              </h3>
              <div className="space-y-2">
                {d.at_risk.clauses.map((c) => (
                  <div key={c.id} className="flex items-center gap-3 p-3 bg-warning/5 rounded-lg">
                    <Shield size={14} className="text-warning flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-text-primary truncate">{c.description}</p>
                      <p className="text-xs text-warning">Clause due {c.due_date} — no evidence</p>
                    </div>
                  </div>
                ))}
                {d.at_risk.milestones.map((m) => (
                  <div key={m.id} className="flex items-center gap-3 p-3 bg-warning/5 rounded-lg">
                    <TrendingUp size={14} className="text-warning flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-text-primary truncate">{m.description}</p>
                      <p className="text-xs text-warning">Milestone due {m.due_date} — no evidence</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Suspicious Patterns */}
          {d.suspicious_patterns.length > 0 && (
            <div className="glass-card p-5 border border-danger/20">
              <h3 className="section-title flex items-center gap-2 mb-4">
                <Flame size={16} className="text-danger" /> Suspicious Patterns
              </h3>
              <div className="space-y-3">
                {d.suspicious_patterns.map((p, i) => (
                  <div key={i} className="p-3 bg-danger/5 rounded-lg border border-danger/15">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <span className="text-sm font-medium text-danger">{p.pattern}</span>
                      <SeverityBadge severity={p.severity} />
                    </div>
                    <p className="text-xs text-text-secondary">{p.description}</p>
                    <p className="text-xs text-warning mt-1 font-medium">→ {p.action}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Clauses Tab */}
      {tab === 'clauses' && (
        <div className="space-y-4 animate-fade-in">
          <div className="flex items-center justify-between">
            <h3 className="section-title">{obligationClauses.length} Contract Clauses</h3>
            <button onClick={() => setAddClauseOpen(true)} className="btn-primary text-sm">
              <Plus size={14} /> Add Clause
            </button>
          </div>
          <DocumentExtractPanel
            target="clauses"
            uploadTarget={uploadTarget}
            setUploadTarget={setUploadTarget}
            uploadFile={uploadFile}
            setUploadFile={setUploadFile}
            uploadMutation={uploadMutation}
            dropLabel="Drop investment pact / contract here"
          />

          {/* Liquidity Rights */}
          <div className="space-y-3">
            <h3 className="section-title">{liquidityClauses.length} Liquidity Rights</h3>
            <DocumentExtractPanel
              target="liquidity_clauses"
              uploadTarget={uploadTarget}
              setUploadTarget={setUploadTarget}
              uploadFile={uploadFile}
              setUploadFile={setUploadFile}
              uploadMutation={uploadMutation}
              dropLabel="Drop shareholder agreement / OCA convention here"
            />
            {liquidityClauses.length > 0 && (
              <div className="space-y-2">
                {liquidityClauses.map((c) => (
                  <LiquidityClauseCard
                    key={c.id}
                    clause={c}
                    onDelete={(cid) => deleteClauseMutation.mutate(cid)}
                    onOpenExerciseLetter={setExerciseLetterClauseId}
                  />
                ))}
              </div>
            )}
          </div>

          {obligationClauses.length === 0 ? (
            <div className="glass-card p-10 text-center">
              <FileText size={28} className="text-text-muted mx-auto mb-2" />
              <p className="text-text-secondary">No clauses yet. Add manually or use AI extraction.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {obligationClauses.map((c) => (
                <ItemRow
                  key={c.id}
                  item={c}
                  type="clause"
                  onUpdate={(cid, data) => updateClauseMutation.mutate({ cid, data })}
                  onDelete={(cid) => deleteClauseMutation.mutate(cid)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Milestones Tab */}
      {tab === 'milestones' && (
        <div className="space-y-4 animate-fade-in">
          <div className="flex items-center justify-between">
            <h3 className="section-title">{d.milestones.length} Plan Milestones</h3>
            <button onClick={() => setAddMilestoneOpen(true)} className="btn-primary text-sm">
              <Plus size={14} /> Add Milestone
            </button>
          </div>
          <DocumentExtractPanel
            target="milestones"
            uploadTarget={uploadTarget}
            setUploadTarget={setUploadTarget}
            uploadFile={uploadFile}
            setUploadFile={setUploadFile}
            uploadMutation={uploadMutation}
            dropLabel="Drop business plan / plan d'etude here"
          />
          {d.milestones.length === 0 ? (
            <div className="glass-card p-10 text-center">
              <CheckSquare size={28} className="text-text-muted mx-auto mb-2" />
              <p className="text-text-secondary">No milestones yet. Add manually or use AI extraction.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {d.milestones.map((m) => (
                <ItemRow
                  key={m.id}
                  item={m}
                  type="milestone"
                  onUpdate={(mid, data) => updateMsMutation.mutate({ mid, data })}
                  onDelete={(mid) => deleteMsMutation.mutate(mid)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Fund Flow Tab */}
      {tab === 'funds' && (
        <div className="space-y-6 animate-fade-in">
          {/* Allocations */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="section-title">Budget Allocations</h3>
              <button onClick={() => setAddAllocOpen(true)} className="btn-primary text-sm"><Plus size={14} /> Add Category</button>
            </div>
            <div className="mb-3">
              <DocumentExtractPanel
                target="allocations"
                uploadTarget={uploadTarget}
                setUploadTarget={setUploadTarget}
                uploadFile={uploadFile}
                setUploadFile={setUploadFile}
                uploadMutation={uploadMutation}
                dropLabel="Drop accountant restructuring report here"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {d.allocations.map((alloc) => {
                const flow = d.fund_flow.find((f) => f.category === alloc.category)
                return (
                  <div key={alloc.id} className="glass-card p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm font-medium text-text-primary">{alloc.category}</p>
                        <p className="text-xl font-bold text-primary mt-1">{alloc.agreed_amount.toLocaleString()} TND</p>
                        {flow && (
                          <p className={clsx('text-xs mt-1', flow.actual > alloc.agreed_amount ? 'text-danger' : 'text-text-muted')}>
                            Spent: {flow.actual.toLocaleString()} TND
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        {flow && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded border font-medium"
                            style={{
                              color: FUND_FLOW_COLORS[flow.status] ?? '#8C948A',
                              borderColor: `${FUND_FLOW_COLORS[flow.status] ?? '#8C948A'}40`,
                              background: `${FUND_FLOW_COLORS[flow.status] ?? '#8C948A'}15`,
                            }}
                          >{flow.status}</span>
                        )}
                        <button onClick={() => deleteAllocMutation.mutate(alloc.id)} className="btn-ghost p-1 text-danger hover:bg-danger/10"><Trash2 size={12} /></button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Fund Flow Chart */}
          {fundFlowData.length > 0 && (
            <div className="glass-card p-5">
              <h3 className="section-title mb-4">Agreed vs. Actual (TND)</h3>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={fundFlowData} margin={{ top: 10, right: 10, left: 0, bottom: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(236,231,219,0.05)" />
                  <XAxis dataKey="name" tick={{ fill: '#8C948A', fontSize: 11 }} angle={-30} textAnchor="end" interval={0} />
                  <YAxis tick={{ fill: '#8C948A', fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ background: 'var(--panel-bg)', border: '1px solid var(--panel-border)', borderRadius: '0', color: 'var(--text-primary)' }}
                    labelStyle={{ color: 'var(--text-primary)' }}
                    itemStyle={{ color: 'var(--text-primary)' }}
                    formatter={(val: number, name: string) => [`${val.toLocaleString()} TND`, name]}
                    labelFormatter={(_, payload) => payload?.[0]?.payload?.fullName ?? ''}
                  />
                  <Legend wrapperStyle={{ color: '#8C948A', fontSize: 12 }} />
                  <Bar dataKey="Agreed" fill="#C4A572" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Actual" radius={[4, 4, 0, 0]}>
                    {fundFlowData.map((entry, i) => (
                      <Cell key={i} fill={FUND_FLOW_COLORS[entry.status] ?? '#8C948A'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Expenditures */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="section-title">Expenditures</h3>
              <button onClick={() => setAddExpOpen(true)} className="btn-primary text-sm"><Plus size={14} /> Record Expense</button>
            </div>
            {d.expenditures.length === 0 ? (
              <div className="glass-card p-8 text-center">
                <DollarSign size={24} className="text-text-muted mx-auto mb-2" />
                <p className="text-text-secondary text-sm">No expenditures recorded yet</p>
              </div>
            ) : (
              <div className="glass-card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-white/[0.06]">
                        {['Date', 'Category', 'Description', 'Amount', 'Vendor', 'Receipt', ''].map((h) => (
                          <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-text-muted">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {d.expenditures.map((exp) => (
                        <tr key={exp.id} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                          <td className="px-4 py-3 text-xs text-text-muted whitespace-nowrap">{exp.date}</td>
                          <td className="px-4 py-3 text-sm text-text-secondary">{exp.category}</td>
                          <td className="px-4 py-3 text-sm text-text-secondary max-w-xs truncate">{exp.description}</td>
                          <td className="px-4 py-3 text-sm font-medium text-text-primary whitespace-nowrap">{exp.amount.toLocaleString()} TND</td>
                          <td className="px-4 py-3 text-xs text-text-muted">{exp.vendor ?? '—'}</td>
                          <td className="px-4 py-3">
                            {exp.has_receipt ? (
                              <CheckCircle2 size={14} className="text-success" />
                            ) : (
                              <AlertTriangle size={14} className="text-warning" />
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <button onClick={() => deleteExpMutation.mutate(exp.id)} className="btn-ghost p-1 text-danger hover:bg-danger/10"><Trash2 size={12} /></button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Alerts Tab */}
      {tab === 'alerts' && (
        <AlertsTab
          alerts={d.alerts}
          onAck={(id) => ackAlertMutation.mutate(id)}
          isPending={ackAlertMutation.isPending}
        />
      )}

      {/* Calendar Tab */}
      {tab === 'calendar' && (
        <div className="animate-fade-in">
          <UnifiedCalendar
            events={d.calendar_events}
            allStartups={[]}
            selectedStartups={[]}
            onSelectedStartupsChange={() => {}}
            title={`${d.investment.startup_name} — Timeline`}
            hideFilter
          />
        </div>
      )}

      <ExerciseLetterModal clauseId={exerciseLetterClauseId} onClose={() => setExerciseLetterClauseId(null)} />

      {/* Add Clause Modal */}
      <Modal open={addClauseOpen} onClose={() => setAddClauseOpen(false)} title="Add Contract Clause">
        <div className="space-y-3">
          <div>
            <label className="label-base">Description *</label>
            <textarea value={clauseDesc} onChange={(e) => setClauseDesc(e.target.value)} className="input-base resize-none" rows={3} placeholder="Describe the obligation..." />
          </div>
          <div>
            <label className="label-base">Due Date</label>
            <input type="date" value={clauseDue} onChange={(e) => setClauseDue(e.target.value)} className="input-base" />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setAddClauseOpen(false)} className="btn-secondary">Cancel</button>
            <button onClick={() => addClauseMutation.mutate()} disabled={!clauseDesc || addClauseMutation.isPending} className="btn-primary">
              {addClauseMutation.isPending ? <Spinner size="sm" /> : 'Add Clause'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Add Milestone Modal */}
      <Modal open={addMilestoneOpen} onClose={() => setAddMilestoneOpen(false)} title="Add Plan Milestone">
        <div className="space-y-3">
          <div>
            <label className="label-base">Description *</label>
            <textarea value={msDesc} onChange={(e) => setMsDesc(e.target.value)} className="input-base resize-none" rows={3} placeholder="Describe the milestone..." />
          </div>
          <div>
            <label className="label-base">Due Date</label>
            <input type="date" value={msDue} onChange={(e) => setMsDue(e.target.value)} className="input-base" />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setAddMilestoneOpen(false)} className="btn-secondary">Cancel</button>
            <button onClick={() => addMsMutation.mutate()} disabled={!msDesc || addMsMutation.isPending} className="btn-primary">
              {addMsMutation.isPending ? <Spinner size="sm" /> : 'Add Milestone'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Add Allocation Modal */}
      <Modal open={addAllocOpen} onClose={() => setAddAllocOpen(false)} title="Add Budget Category">
        <div className="space-y-3">
          <div>
            <label className="label-base">Category *</label>
            <input value={allocCat} onChange={(e) => setAllocCat(e.target.value)} className="input-base" placeholder="e.g., Equipment, Personnel, Marketing" />
          </div>
          <div>
            <label className="label-base">Agreed Amount (TND) *</label>
            <input type="number" value={allocAmt} onChange={(e) => setAllocAmt(e.target.value)} className="input-base" placeholder="e.g., 50000" />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setAddAllocOpen(false)} className="btn-secondary">Cancel</button>
            <button onClick={() => addAllocMutation.mutate()} disabled={!allocCat || !allocAmt || addAllocMutation.isPending} className="btn-primary">
              {addAllocMutation.isPending ? <Spinner size="sm" /> : 'Add Category'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Add Expenditure Modal */}
      <Modal open={addExpOpen} onClose={() => setAddExpOpen(false)} title="Record Expenditure" size="lg">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label-base">Category *</label>
            <input value={expForm.category} onChange={(e) => setExpForm((f) => ({ ...f, category: e.target.value }))} className="input-base" placeholder="e.g., Equipment" />
          </div>
          <div>
            <label className="label-base">Amount (TND) *</label>
            <input type="number" value={expForm.amount} onChange={(e) => setExpForm((f) => ({ ...f, amount: e.target.value }))} className="input-base" />
          </div>
          <div>
            <label className="label-base">Date *</label>
            <input type="date" value={expForm.date} onChange={(e) => setExpForm((f) => ({ ...f, date: e.target.value }))} className="input-base" />
          </div>
          <div>
            <label className="label-base">Vendor</label>
            <input value={expForm.vendor} onChange={(e) => setExpForm((f) => ({ ...f, vendor: e.target.value }))} className="input-base" placeholder="Optional" />
          </div>
          <div className="col-span-2">
            <label className="label-base">Description</label>
            <input value={expForm.description} onChange={(e) => setExpForm((f) => ({ ...f, description: e.target.value }))} className="input-base" placeholder="Optional" />
          </div>
          <div className="col-span-2 flex items-center gap-2">
            <input
              type="checkbox"
              id="receipt"
              checked={expForm.has_receipt}
              onChange={(e) => setExpForm((f) => ({ ...f, has_receipt: e.target.checked }))}
              className="accent-primary w-4 h-4"
            />
            <label htmlFor="receipt" className="text-sm text-text-secondary cursor-pointer">Has supporting receipt/invoice</label>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={() => setAddExpOpen(false)} className="btn-secondary">Cancel</button>
          <button onClick={() => addExpMutation.mutate()} disabled={!expForm.category || !expForm.amount || addExpMutation.isPending} className="btn-primary">
            {addExpMutation.isPending ? <Spinner size="sm" /> : 'Record Expenditure'}
          </button>
        </div>
      </Modal>
    </Layout>
  )
}
