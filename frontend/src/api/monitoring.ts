import client from './client'
import type {
  Investment,
  InvestmentDashboard,
  ContractClause,
  PlanMilestone,
  FundAllocation,
  Expenditure,
  MonitoringAlert,
  WeeklyDigest,
  PortfolioOverview,
} from '../types'

export const monitoringApi = {
  // Investments
  list: async (): Promise<{ investments: Investment[] }> => {
    const { data } = await client.get('/monitoring/investments')
    return data
  },

  create: async (payload: {
    startup_name: string
    startup_sector?: string
    stage?: string
    contract_start_date: string
    contract_end_date: string
    contract_duration_years: number
    total_amount_tnd?: number
    description?: string
  }): Promise<Investment> => {
    const { data } = await client.post('/monitoring/investments', payload)
    return data
  },

  update: async (
    id: number,
    payload: Partial<{
      startup_name: string
      startup_sector: string
      stage: string
      contract_start_date: string
      contract_end_date: string
      contract_duration_years: number
      total_amount_tnd: number
      description: string
    }>
  ): Promise<Investment> => {
    const { data } = await client.put(`/monitoring/investments/${id}`, payload)
    return data
  },

  delete: async (id: number): Promise<void> => {
    await client.delete(`/monitoring/investments/${id}`)
  },

  // Dashboard
  dashboard: async (id: number): Promise<InvestmentDashboard> => {
    const { data } = await client.get(`/monitoring/investments/${id}/dashboard`)
    return data
  },

  // Global Investments Dashboard
  portfolioOverview: async (): Promise<PortfolioOverview> => {
    const { data } = await client.get('/monitoring/portfolio/overview')
    return data
  },

  runChecks: async (id: number): Promise<{ alerts: MonitoringAlert[] }> => {
    const { data } = await client.post(`/monitoring/investments/${id}/run-checks`)
    return data
  },

  // Document extraction
  extractClauses: async (id: number, file: File) => {
    const form = new FormData()
    form.append('file', file)
    const { data } = await client.post(`/monitoring/investments/${id}/extract-clauses`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return data
  },

  extractMilestones: async (id: number, file: File) => {
    const form = new FormData()
    form.append('file', file)
    const { data } = await client.post(`/monitoring/investments/${id}/extract-milestones`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return data
  },

  extractAllocations: async (id: number, file: File) => {
    const form = new FormData()
    form.append('file', file)
    const { data } = await client.post(`/monitoring/investments/${id}/extract-allocations`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return data
  },

  extractLiquidityClauses: async (id: number, file: File) => {
    const form = new FormData()
    form.append('file', file)
    const { data } = await client.post(`/monitoring/investments/${id}/extract-liquidity-clauses`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return data
  },

  // Clauses
  addClause: async (id: number, description: string, due_date?: string): Promise<ContractClause> => {
    const { data } = await client.post(`/monitoring/investments/${id}/clauses`, { description, due_date })
    return data
  },

  updateClause: async (
    clauseId: number,
    payload: {
      status?: string
      evidence_note?: string
      due_date?: string
      description?: string
      clause_type?: string
      trigger_condition?: string
      right_holder?: string
      numbers?: { price?: number; share_count?: number; threshold?: number }
    }
  ): Promise<ContractClause> => {
    const { data } = await client.patch(`/monitoring/clauses/${clauseId}`, payload)
    return data
  },

  deleteClause: async (clauseId: number): Promise<void> => {
    await client.delete(`/monitoring/clauses/${clauseId}`)
  },

  // Exercise letters (liquidity-rights clauses)
  getExerciseLetter: async (
    clauseId: number
  ): Promise<{ letter_markdown: string; source: 'ollama' | 'fallback'; clause: ContractClause }> => {
    const { data } = await client.get(`/monitoring/clauses/${clauseId}/exercise-letter`)
    return data
  },

  downloadExerciseLetterPdf: async (clauseId: number): Promise<Blob> => {
    const { data } = await client.get(`/monitoring/clauses/${clauseId}/exercise-letter.pdf`, {
      responseType: 'blob',
    })
    return data
  },

  // Milestones
  addMilestone: async (id: number, description: string, due_date?: string): Promise<PlanMilestone> => {
    const { data } = await client.post(`/monitoring/investments/${id}/milestones`, { description, due_date })
    return data
  },

  updateMilestone: async (
    msId: number,
    payload: { status?: string; evidence_note?: string; due_date?: string; description?: string }
  ): Promise<PlanMilestone> => {
    const { data } = await client.patch(`/monitoring/milestones/${msId}`, payload)
    return data
  },

  deleteMilestone: async (msId: number): Promise<void> => {
    await client.delete(`/monitoring/milestones/${msId}`)
  },

  // Allocations
  addAllocation: async (id: number, category: string, agreed_amount: number): Promise<FundAllocation> => {
    const { data } = await client.post(`/monitoring/investments/${id}/allocations`, { category, agreed_amount })
    return data
  },

  deleteAllocation: async (allocId: number): Promise<void> => {
    await client.delete(`/monitoring/allocations/${allocId}`)
  },

  // Expenditures
  addExpenditure: async (
    id: number,
    payload: {
      category: string
      amount: number
      description?: string
      date: string
      has_receipt: boolean
      vendor?: string
    }
  ): Promise<Expenditure> => {
    const { data } = await client.post(`/monitoring/investments/${id}/expenditures`, payload)
    return data
  },

  deleteExpenditure: async (expId: number): Promise<void> => {
    await client.delete(`/monitoring/expenditures/${expId}`)
  },

  // Alerts
  acknowledgeAlert: async (alertId: number): Promise<MonitoringAlert> => {
    const { data } = await client.patch(`/monitoring/alerts/${alertId}/acknowledge`)
    return data
  },

  // Weekly digests (Portfolio Watchdog)
  listDigests: async (): Promise<{ digests: WeeklyDigest[] }> => {
    const { data } = await client.get('/monitoring/digests')
    return data
  },

  getDigest: async (id: number): Promise<WeeklyDigest> => {
    const { data } = await client.get(`/monitoring/digests/${id}`)
    return data
  },

  markDigestRead: async (id: number): Promise<WeeklyDigest> => {
    const { data } = await client.patch(`/monitoring/digests/${id}/read`)
    return data
  },

  runDigestNow: async (): Promise<{ digest: WeeklyDigest | null; message?: string }> => {
    const { data } = await client.post('/monitoring/digests/run-now')
    return data
  },

  resendDigestEmail: async (
    id: number
  ): Promise<{
    digest: WeeklyDigest
    sent: boolean
    reason?: 'cooldown' | 'duplicate' | 'smtp_off'
    retry_after?: number
  }> => {
    const { data } = await client.post(`/monitoring/digests/${id}/resend-email`)
    return data
  },
}
