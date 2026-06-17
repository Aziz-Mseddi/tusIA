// ─── Auth ─────────────────────────────────────────────────────────────────────
export interface Investor {
  id: number
  email: string
  full_name?: string
}

export interface AuthResponse {
  access_token: string
  token_type: string
  investor: Investor
}

// ─── Scoring ──────────────────────────────────────────────────────────────────
export interface ScoreNotes {
  growth_score?: number | null
  market_growth_norm?: number | null
  tam_score?: number | null
  margin_score?: number | null
  debt_score?: number | null
  liquidity_score?: number | null
  comp_score?: number | null
  reg_score?: number | null
  esg_norm?: number | null
  penalty_total?: number
  penalty_reasons?: string[]
}

export interface ScoreResult {
  final_score: number
  grade: 'A' | 'B' | 'C' | 'D' | 'F'
  decision_zone: 'Green' | 'Orange' | 'Red'
  risk_total: number
  risk_level: 'Low' | 'Medium' | 'High'
  estimated_roi: number
  env_factor: number
  raw_score: number
  pillars: {
    execution?: number | null
    market: number
    financial?: number | null
    external?: number | null
  }
  notes?: ScoreNotes
}

// ─── Startups ─────────────────────────────────────────────────────────────────
export interface Startup {
  id: number
  name: string
  country: string
  region: string
  sector: string
  sub_sector?: string
  stage: string
  founded_year: number
  age_years: number
  employees: number
  annual_revenue_usd?: number
  revenue_cagr_3y?: number
  ebitda_margin?: number
  total_addressable_market_M?: number
  market_growth_rate?: number
  competition_intensity?: number
  regulatory_stability?: number
  debt_to_ebitda?: number
  current_ratio?: number
  local_infrastructure?: number
  esg_score?: number
  business_model: string
  tech_enabled: boolean
  exit_status: 'active' | 'failed' | 'acquired' | 'ipo'
  failure_reason?: string
  description?: string
  tags?: string
  score_result: ScoreResult
}

export interface StartupMeta {
  total: number
  sectors: { name: string; count: number }[]
  countries: string[]
  regions: string[]
  sub_sectors: string[]
}

// ─── Mode 1 ───────────────────────────────────────────────────────────────────
export interface FilterRequest {
  // Categorical
  sectors?: string[]
  countries?: string[]
  regions?: string[]
  stages?: string[]
  business_models?: string[]
  exit_statuses?: string[]
  sub_sectors?: string[]
  tech_enabled?: boolean
  // Size
  min_employees?: number
  max_employees?: number
  min_founded_year?: number
  max_founded_year?: number
  min_age_years?: number
  max_age_years?: number
  // Financial
  min_revenue_usd?: number
  max_revenue_usd?: number
  min_revenue_cagr?: number
  max_revenue_cagr?: number
  min_ebitda_margin?: number
  max_ebitda_margin?: number
  // Market
  min_market_size_M?: number
  max_market_size_M?: number
  min_market_growth_rate?: number
  max_market_growth_rate?: number
  min_competition_intensity?: number
  max_competition_intensity?: number
  // Risk & Quality
  min_regulatory_stability?: number
  max_regulatory_stability?: number
  min_esg_score?: number
  max_esg_score?: number
}

export interface FilterResponse {
  total: number
  results: Startup[]
}

export interface PromptFilterResponse extends FilterResponse {
  interpreted_filters: Record<string, unknown>
}

export interface InvestmentSuggestion {
  theme: string
  rationale: string
  supporting_sectors: string[]
  risk_level: 'Low' | 'Medium' | 'High'
  example_countries: string[]
}

export interface SuggestionsResponse {
  suggestions: InvestmentSuggestion[]
}

export interface ThesisWatchlistItem {
  name: string
  score: number
}

export interface RankedThesis {
  rank: number
  theme: string
  rationale: string
  supporting_sectors: string[]
  risk_level: 'Low' | 'Medium' | 'High'
  watchlist?: ThesisWatchlistItem[]
}

export interface ThemeRun {
  id: number
  period_start: string
  period_end: string
  generated_at: string | null
  subject: string
  body_markdown: string
  theses: RankedThesis[]
  diff: string[]
  source: 'ollama' | 'fallback'
  read: boolean
}

export interface ThemesLatestResponse {
  run: ThemeRun | null
}

export interface ThemeRunResponse {
  run: ThemeRun
}

// ─── Mode 2 ───────────────────────────────────────────────────────────────────
export interface StartupProfile {
  name?: string
  sector?: string
  sub_sector?: string
  stage?: string
  business_model?: string
  tech_enabled?: boolean
  employees_estimate?: number
  revenue_estimate_usd?: number
  description?: string
  tags?: string[]
  target_market?: string
  key_product?: string
}

export interface ExtractProfileResponse {
  extracted_profiles: StartupProfile[]
  is_multiple: boolean
  raw_text_preview: string
  files_processed: string[]
  error?: string
}

export interface AnalogueByCountry {
  country: string
  count: number
  avg_score: number
  success_rate_percent: number
  startups: Startup[]
}

export interface FindAnaloguesResponse {
  total_analogues: number
  countries_represented: number
  success_count: number
  failure_count: number
  success_rate_percent: number
  failure_rate_percent: number
  match_relaxed: boolean
  warning?: string
  by_country: AnalogueByCountry[]
}

export interface AnaloguesSummary {
  total_analogues: number
  countries_represented: number
  success_rate_percent: number
  failure_rate_percent: number
  top_failure_reasons: string[]
  top_success_signals: string[]
  countries: string[]
  avg_score_by_country: Record<string, number>
}

export interface ViabilityVerdict {
  recommendation: 'INVEST' | 'CAUTION' | 'AVOID'
  confidence: 'LOW' | 'MEDIUM' | 'HIGH'
  simulated_success_probability_percent: number
  favorable_signals: string[]
  risk_factors: string[]
  country_benchmark: string
  country_benchmark_reason: string
  explanation: string
}

export interface FounderQuestion {
  theme: 'market' | 'unit_economics' | 'moat' | 'team' | 'regulatory' | string
  question: string
  gap: string
  why_it_matters: string
}

export interface FounderQuestionsResponse {
  questions: FounderQuestion[]
}

export interface FindAnaloguesBatchResult {
  profile_name: string
  analogues: FindAnaloguesResponse
  overall_avg_score: number
  success_rate_percent: number
}

export interface FindAnaloguesBatchResponse {
  results: FindAnaloguesBatchResult[]
  best_choice_name: string | null
  best_choice_reason: string
}

export interface MultiViabilityVerdictItem extends ViabilityVerdict {
  name: string
}

export interface MultiViabilityVerdict {
  best_choice_name: string
  best_choice_reason: string
  items: MultiViabilityVerdictItem[]
}

export interface Mode2Job {
  id: number
  job_type: 'extract' | 'verdict' | 'multi_verdict'
  status: 'pending' | 'done' | 'error'
  result: ExtractProfileResponse | ViabilityVerdict | MultiViabilityVerdict | null
  error: string | null
}

export interface Mode2AssessmentSummary {
  id: number
  created_at: string
  title: string
  is_multiple: boolean
  headline?: string | null
}

export interface Mode2AssessmentDetail extends Mode2AssessmentSummary {
  profile: StartupProfile | StartupProfile[]
  analogues?: FindAnaloguesResponse | FindAnaloguesBatchResponse | null
  verdict?: ViabilityVerdict | MultiViabilityVerdict | null
  source_filenames?: string[] | null
}

// ─── Monitoring ───────────────────────────────────────────────────────────────
export interface Investment {
  id: number
  startup_name: string
  startup_sector?: string
  stage: string
  contract_start_date: string
  contract_end_date: string
  contract_duration_years: number
  total_amount_tnd?: number
  description?: string
  created_at: string
  days_remaining?: number
  unacknowledged_alerts: number
}

export interface ContractClause {
  id: number
  description: string
  due_date?: string
  status: 'pending' | 'in_progress' | 'fulfilled' | 'overdue'
  evidence_note?: string
  fulfilled_at?: string
  created_at: string
  clause_type: string
  trigger_condition?: string | null
  right_holder?: string | null
  numbers?: { price?: number; share_count?: number; threshold?: number } | null
}

export interface PlanMilestone {
  id: number
  description: string
  due_date?: string
  status: 'pending' | 'in_progress' | 'fulfilled' | 'overdue'
  evidence_note?: string
  fulfilled_at?: string
  created_at: string
}

export interface FundAllocation {
  id: number
  category: string
  agreed_amount: number
}

export interface Expenditure {
  id: number
  category: string
  description?: string
  amount: number
  date: string
  has_receipt: boolean
  vendor?: string
  created_at: string
}

export interface FundFlowItem {
  category: string
  agreed: number
  actual: number
  delta: number
  pct?: number
  status: string
  severity?: string
  in_contract: boolean
  missing_receipts: number
}

export interface MonitoringAlert {
  id: number
  triggered_by: string
  severity: 'INFO' | 'WARNING' | 'ALERT' | 'CRITICAL'
  message: string
  recipient: string
  acknowledged: boolean
  created_at: string
}

export interface SuspiciousPattern {
  severity: string
  pattern: string
  description: string
  action: string
}

export interface DashboardStats {
  total_clauses: number
  fulfilled_clauses: number
  overdue_clauses: number
  at_risk_clauses: number
  total_milestones: number
  fulfilled_milestones: number
  overdue_milestones: number
  at_risk_milestones: number
  unacknowledged_alerts: number
  total_agreed_tnd: number
  total_actual_tnd: number
  unverified_spend_tnd: number
  suspicious_patterns: number
}

export interface InvestmentDashboard {
  investment: Investment
  days_remaining?: number
  clauses: ContractClause[]
  milestones: PlanMilestone[]
  allocations: FundAllocation[]
  expenditures: Expenditure[]
  fund_flow: FundFlowItem[]
  alerts: MonitoringAlert[]
  suspicious_patterns: SuspiciousPattern[]
  at_risk: {
    clauses: ContractClause[]
    milestones: PlanMilestone[]
  }
  stats: DashboardStats
  calendar_events: TimelineEvent[]
}

// ─── Global Investments Dashboard ──────────────────────────────────────────────
export interface TimelineEvent {
  id: string
  type: 'clause' | 'milestone' | 'fund_flow' | 'alert'
  investment_id: number
  startup_name: string
  title: string
  date: string
  status?: 'pending' | 'in_progress' | 'fulfilled' | 'overdue'
  severity?: 'INFO' | 'WARNING' | 'ALERT' | 'CRITICAL'
  category?: string
  amount?: number
  acknowledged?: boolean
  clause_type?: string
}

export interface PortfolioStatusBreakdown {
  total: number
  pending: number
  in_progress: number
  overdue: number
  fulfilled: number
  at_risk: number
}

export interface PortfolioSummary {
  clauses: PortfolioStatusBreakdown
  milestones: PortfolioStatusBreakdown
  at_risk_total: number
  suspicious_patterns_count: number
}

export interface PortfolioInvestmentSummary extends Investment {
  clauses: ContractClause[]
  milestones: PlanMilestone[]
  fund_flow: FundFlowItem[]
}

export interface PortfolioOverview {
  investments: PortfolioInvestmentSummary[]
  timeline: TimelineEvent[]
  summary: PortfolioSummary
}

// ─── Weekly Digest (Portfolio Watchdog) ────────────────────────────────────────
export interface DigestTodo {
  priority: number
  investment_id: number
  investment_name: string
  title: string
  severity: 'INFO' | 'WARNING' | 'ALERT' | 'CRITICAL'
  why: string
  action: string
  related_triggers: string[]
}

export interface DigestAlertItem {
  severity: 'INFO' | 'WARNING' | 'ALERT' | 'CRITICAL'
  message: string
}

export interface DigestInvestmentAlerts {
  investment_id: number
  investment_name: string
  severity: 'INFO' | 'WARNING' | 'ALERT' | 'CRITICAL'
  total: number
  alerts: DigestAlertItem[]
}

export interface HeadsUpItem {
  investment_id: number
  investment_name: string
  type: 'clause' | 'milestone'
  description: string
  due_date: string
  severity: 'INFO' | 'WARNING' | 'ALERT' | 'CRITICAL'
}

export interface WeeklyDigest {
  id: number
  period_start: string
  period_end: string
  generated_at: string
  subject: string
  source: 'ollama' | 'fallback'
  read: boolean
  email_sent: boolean
  email_sent_count: number
  last_email_sent_at: string | null
  stats: Record<string, number>
  body_markdown?: string
  todos?: DigestTodo[]
  investment_alerts?: DigestInvestmentAlerts[]
  heads_up_next_week?: HeadsUpItem[]
}

// ─── Chat ─────────────────────────────────────────────────────────────────────
export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  /** Assistant only: the model's thinking/reasoning trace, if any. */
  reasoning?: string
}

export interface ChatResponse {
  reply: string
  reasoning?: string
}

export interface ChatSession {
  id: number
  title: string
  created_at: string
  updated_at?: string
  message_count: number
}

export interface ChatSessionsResponse {
  sessions: ChatSession[]
}

export interface ChatSessionDetail {
  id: number
  title: string
  created_at: string
  messages: ChatMessage[]
}

// ─── Health ───────────────────────────────────────────────────────────────────
export interface HealthResponse {
  status: string
  ollama_available: boolean
}
