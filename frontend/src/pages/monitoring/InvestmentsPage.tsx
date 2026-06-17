import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  Plus, Trash2, Edit3, Bell, Calendar, Clock, ArrowRight, BarChart3
} from 'lucide-react'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import { Layout } from '../../components/layout/Layout'
import { Modal } from '../../components/ui/Modal'
import { SeverityBadge } from '../../components/ui/Badge'
import { FullPageSpinner, Spinner } from '../../components/ui/Spinner'
import { monitoringApi } from '../../api/monitoring'
import type { Investment } from '../../types'
import { clsx } from 'clsx'

const STAGES = ['creation', 'development', 'restructuring']

function InvestmentForm({
  initial,
  onSubmit,
  onCancel,
  loading,
}: {
  initial?: Partial<Investment>
  onSubmit: (d: any) => void
  onCancel: () => void
  loading: boolean
}) {
  const [form, setForm] = useState({
    startup_name: initial?.startup_name ?? '',
    startup_sector: initial?.startup_sector ?? '',
    stage: initial?.stage ?? 'development',
    contract_start_date: initial?.contract_start_date ?? '',
    contract_end_date: initial?.contract_end_date ?? '',
    contract_duration_years: initial?.contract_duration_years ?? 1,
    total_amount_tnd: initial?.total_amount_tnd ?? '',
    description: initial?.description ?? '',
  })

  function submit(e: React.FormEvent) {
    e.preventDefault()
    onSubmit({
      ...form,
      contract_duration_years: Number(form.contract_duration_years),
      total_amount_tnd: form.total_amount_tnd ? Number(form.total_amount_tnd) : undefined,
    })
  }

  const f = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }))

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="label-base">Startup Name *</label>
          <input value={form.startup_name} onChange={f('startup_name')} required className="input-base" placeholder="e.g., TechStart TN" />
        </div>
        <div>
          <label className="label-base">Sector</label>
          <input value={form.startup_sector} onChange={f('startup_sector')} className="input-base" placeholder="e.g., Fintech" />
        </div>
        <div>
          <label className="label-base">Stage</label>
          <select value={form.stage} onChange={f('stage')} className="input-base bg-surface">
            {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="label-base">Contract Start *</label>
          <input type="date" value={form.contract_start_date} onChange={f('contract_start_date')} required className="input-base" />
        </div>
        <div>
          <label className="label-base">Contract End *</label>
          <input type="date" value={form.contract_end_date} onChange={f('contract_end_date')} required className="input-base" />
        </div>
        <div>
          <label className="label-base">Duration (years)</label>
          <input type="number" min={1} value={form.contract_duration_years} onChange={f('contract_duration_years')} className="input-base" />
        </div>
        <div>
          <label className="label-base">Total Amount (TND)</label>
          <input type="number" value={form.total_amount_tnd} onChange={f('total_amount_tnd')} className="input-base" placeholder="Optional" />
        </div>
        <div className="col-span-2">
          <label className="label-base">Description</label>
          <textarea value={form.description} onChange={f('description')} className="input-base resize-none" rows={2} placeholder="Optional notes..." />
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onCancel} className="btn-secondary">Cancel</button>
        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? <Spinner size="sm" /> : (initial ? 'Save Changes' : 'Create Investment')}
        </button>
      </div>
    </form>
  )
}

function InvestmentCard({ inv, onEdit, onDelete }: { inv: Investment; onEdit: () => void; onDelete: () => void }) {
  const daysLeft = inv.days_remaining
  const urgent = daysLeft != null && daysLeft < 30

  return (
    <div className="glass-card-hover p-5">
      <div className="flex items-start justify-between gap-3">
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
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={onEdit} className="btn-ghost p-1.5"><Edit3 size={14} /></button>
          <button onClick={onDelete} className="btn-ghost p-1.5 text-danger hover:bg-danger/10"><Trash2 size={14} /></button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4">
        <div className="flex items-center gap-1.5 text-xs text-text-secondary">
          <Calendar size={12} className="text-text-muted" />
          <span>{inv.contract_start_date}</span>
        </div>
        <div className={clsx('flex items-center gap-1.5 text-xs', urgent ? 'text-danger' : 'text-text-secondary')}>
          <Clock size={12} className={urgent ? 'text-danger' : 'text-text-muted'} />
          <span>{daysLeft != null ? `${daysLeft}d remaining` : inv.contract_end_date}</span>
        </div>
        {inv.total_amount_tnd != null && (
          <div className="flex items-center gap-1.5 text-xs text-text-secondary">
            <span className="text-text-muted">TND</span>
            <span className="font-medium">{inv.total_amount_tnd.toLocaleString()}</span>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between mt-4 pt-3 border-t border-white/[0.05]">
        {inv.unacknowledged_alerts > 0 ? (
          <div className="flex items-center gap-1.5 text-xs text-danger">
            <Bell size={12} />
            <span>{inv.unacknowledged_alerts} unread alert{inv.unacknowledged_alerts > 1 ? 's' : ''}</span>
          </div>
        ) : (
          <span className="text-xs text-text-muted">No pending alerts</span>
        )}
        <Link to={`/monitoring/${inv.id}`} className="btn-primary text-xs py-1.5 px-3">
          View Dashboard <ArrowRight size={12} />
        </Link>
      </div>
    </div>
  )
}

export default function InvestmentsPage() {
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Investment | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Investment | null>(null)

  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['investments'],
    queryFn: monitoringApi.list,
  })

  const createMutation = useMutation({
    mutationFn: monitoringApi.create,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['investments'] }); setCreateOpen(false); toast.success('Investment created') },
    onError: (e: any) => toast.error(e.response?.data?.detail || 'Failed'),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, ...d }: any) => monitoringApi.update(id, d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['investments'] }); setEditTarget(null); toast.success('Investment updated') },
    onError: (e: any) => toast.error(e.response?.data?.detail || 'Failed'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => monitoringApi.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['investments'] }); setDeleteTarget(null); toast.success('Investment deleted') },
    onError: () => toast.error('Delete failed'),
  })

  const investments = data?.investments ?? []

  return (
    <Layout title="My Investments">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="page-title">My Investments</h2>
          <p className="text-sm text-text-muted mt-1">{investments.length} portfolio{investments.length !== 1 ? 's' : ''} tracked</p>
        </div>
        <button onClick={() => setCreateOpen(true)} className="btn-primary">
          <Plus size={16} /> New Investment
        </button>
      </div>

      {isLoading && <FullPageSpinner />}

      {!isLoading && investments.length === 0 && (
        <div className="glass-card p-14 text-center">
          <BarChart3 size={40} className="text-text-muted mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-text-secondary">No investments yet</h3>
          <p className="text-sm text-text-muted mt-1 mb-5">Start tracking your portfolio by creating your first investment</p>
          <button onClick={() => setCreateOpen(true)} className="btn-primary">
            <Plus size={15} /> Create First Investment
          </button>
        </div>
      )}

      {!isLoading && investments.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-5">
          {investments.map((inv) => (
            <InvestmentCard
              key={inv.id}
              inv={inv}
              onEdit={() => setEditTarget(inv)}
              onDelete={() => setDeleteTarget(inv)}
            />
          ))}
        </div>
      )}

      {/* Create Modal */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New Investment" size="lg">
        <InvestmentForm
          onSubmit={(d) => createMutation.mutate(d)}
          onCancel={() => setCreateOpen(false)}
          loading={createMutation.isPending}
        />
      </Modal>

      {/* Edit Modal */}
      <Modal open={!!editTarget} onClose={() => setEditTarget(null)} title="Edit Investment" size="lg">
        {editTarget && (
          <InvestmentForm
            initial={editTarget}
            onSubmit={(d) => updateMutation.mutate({ id: editTarget.id, ...d })}
            onCancel={() => setEditTarget(null)}
            loading={updateMutation.isPending}
          />
        )}
      </Modal>

      {/* Delete Confirm Modal */}
      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete Investment" size="sm">
        <p className="text-sm text-text-secondary mb-4">
          Are you sure you want to delete <span className="font-semibold text-text-primary">{deleteTarget?.startup_name}</span>?
          This will permanently delete all clauses, milestones, allocations, and alerts.
        </p>
        <div className="flex justify-end gap-2">
          <button onClick={() => setDeleteTarget(null)} className="btn-secondary">Cancel</button>
          <button
            onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            disabled={deleteMutation.isPending}
            className="btn-danger"
          >
            {deleteMutation.isPending ? <Spinner size="sm" /> : 'Delete'}
          </button>
        </div>
      </Modal>
    </Layout>
  )
}
