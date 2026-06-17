from sqlalchemy import Column, Integer, Float, Text, Boolean, DateTime, ForeignKey
from sqlalchemy.sql import func
from database import Base


class MetricsBenchmark(Base):
    """
    African-market benchmark values used by the scoring engine.
    Each row stores the average and best-in-class value for one metric,
    plus a flag indicating whether a lower value is better (e.g. debt ratios).
    Overrides DEFAULT_BENCHMARKS constants when present.
    """
    __tablename__ = "metrics_benchmarks"

    metric_name  = Column(Text, primary_key=True)   # e.g. "revenue_cagr_3y"
    african_avg  = Column(Float, nullable=False)     # continent average
    african_best = Column(Float, nullable=False)     # best-in-class reference
    is_negative  = Column(Boolean, nullable=False, default=False)  # lower = better
    description  = Column(Text, nullable=True)
    updated_at   = Column(DateTime(timezone=True), server_default=func.now())


class Investor(Base):
    __tablename__ = "investors"

    id             = Column(Integer, primary_key=True, index=True)
    email          = Column(Text, unique=True, nullable=False, index=True)
    hashed_password = Column(Text, nullable=False)
    full_name      = Column(Text, nullable=True)
    # User-supplied cloud LLM key (dev: plaintext). The DB column is still named
    # `gemini_api_key` for backward compatibility; the cloud provider is now OpenRouter.
    openrouter_api_key = Column("gemini_api_key", Text, nullable=True)
    created_at     = Column(DateTime(timezone=True), server_default=func.now())


# ── Post-Investment Monitoring ────────────────────────────────────────────────

class Investment(Base):
    __tablename__ = "investments"

    id                      = Column(Integer, primary_key=True, index=True)
    investor_id             = Column(Integer, ForeignKey("investors.id"), nullable=False)
    startup_name            = Column(Text, nullable=False)
    startup_sector          = Column(Text, nullable=True)
    stage                   = Column(Text, nullable=False, default="development")
    contract_start_date     = Column(Text, nullable=False)   # ISO date string
    contract_end_date       = Column(Text, nullable=False)
    contract_duration_years = Column(Integer, nullable=False)
    total_amount_tnd        = Column(Float, nullable=True)
    description             = Column(Text, nullable=True)
    created_at              = Column(DateTime(timezone=True), server_default=func.now())


class ContractClause(Base):
    __tablename__ = "contract_clauses"

    id            = Column(Integer, primary_key=True, index=True)
    investment_id = Column(Integer, ForeignKey("investments.id"), nullable=False)
    description   = Column(Text, nullable=False)
    due_date      = Column(Text, nullable=True)
    status        = Column(Text, nullable=False, default="pending")  # pending/in_progress/fulfilled/overdue
    evidence_note = Column(Text, nullable=True)
    fulfilled_at  = Column(Text, nullable=True)
    created_at    = Column(DateTime(timezone=True), server_default=func.now())

    # Liquidity-rights clauses extracted from shareholder agreements / OCA
    # conventions (put options, drag-along/tag-along, ratchets) are stored
    # here too, distinguished by `clause_type`. Regular contractual
    # obligations keep the default "obligation" type.
    clause_type       = Column(Text, nullable=False, default="obligation")
    # "obligation" | "put_option" | "drag_along" | "tag_along" | "ratchet"
    trigger_condition = Column(Text, nullable=True)   # what triggers the right
    right_holder      = Column(Text, nullable=True)   # who holds the right
    numbers_json      = Column(Text, nullable=True)   # JSON: {"price":.., "share_count":.., "threshold":..}


class PlanMilestone(Base):
    __tablename__ = "plan_milestones"

    id            = Column(Integer, primary_key=True, index=True)
    investment_id = Column(Integer, ForeignKey("investments.id"), nullable=False)
    description   = Column(Text, nullable=False)
    due_date      = Column(Text, nullable=True)
    status        = Column(Text, nullable=False, default="pending")
    evidence_note = Column(Text, nullable=True)
    fulfilled_at  = Column(Text, nullable=True)
    created_at    = Column(DateTime(timezone=True), server_default=func.now())


class FundAllocation(Base):
    __tablename__ = "fund_allocations"

    id            = Column(Integer, primary_key=True, index=True)
    investment_id = Column(Integer, ForeignKey("investments.id"), nullable=False)
    category      = Column(Text, nullable=False)
    agreed_amount = Column(Float, nullable=False)


class Expenditure(Base):
    __tablename__ = "expenditures"

    id            = Column(Integer, primary_key=True, index=True)
    investment_id = Column(Integer, ForeignKey("investments.id"), nullable=False)
    category      = Column(Text, nullable=False)
    amount        = Column(Float, nullable=False)
    description   = Column(Text, nullable=True)
    date          = Column(Text, nullable=False)
    has_receipt   = Column(Boolean, nullable=False, default=False)
    vendor        = Column(Text, nullable=True)
    created_at    = Column(DateTime(timezone=True), server_default=func.now())


class MonitoringAlert(Base):
    __tablename__ = "monitoring_alerts"

    id            = Column(Integer, primary_key=True, index=True)
    investment_id = Column(Integer, ForeignKey("investments.id"), nullable=False)
    triggered_by  = Column(Text, nullable=False)
    severity      = Column(Text, nullable=False)   # INFO / WARNING / ALERT / CRITICAL
    message       = Column(Text, nullable=False)
    recipient     = Column(Text, nullable=False, default="investor")
    acknowledged  = Column(Boolean, nullable=False, default=False)
    created_at    = Column(DateTime(timezone=True), server_default=func.now())


class WeeklyDigest(Base):
    """
    Output of the Portfolio Watchdog agent: one prioritised weekly "action list"
    per investor. The agent runs all deterministic checks across every investment,
    clusters co-occurring signals into root-cause findings, then drafts an investor
    email + a prioritised todo list. Stored (not emailed) for in-app reading.
    """
    __tablename__ = "weekly_digests"

    id            = Column(Integer, primary_key=True, index=True)
    investor_id   = Column(Integer, ForeignKey("investors.id"), nullable=False, index=True)
    period_start  = Column(Text, nullable=False)   # ISO date — Monday of the covered week
    period_end    = Column(Text, nullable=False)   # ISO date — Sunday of the covered week
    generated_at  = Column(DateTime(timezone=True), server_default=func.now())
    subject       = Column(Text, nullable=False)   # drafted email subject
    body_markdown = Column(Text, nullable=False)   # drafted investor email / narrative
    todos_json    = Column(Text, nullable=False, default="[]")  # JSON list of todo items
    investment_alerts_json = Column(Text, nullable=False, default="[]")  # JSON per-investment ranked alerts
    stats_json    = Column(Text, nullable=False, default="{}")  # JSON severity counts
    source        = Column(Text, nullable=False, default="ollama")  # "ollama" | "fallback"
    read          = Column(Boolean, nullable=False, default=False)
    email_sent    = Column(Boolean, nullable=False, default=False)
    email_sent_count   = Column(Integer, nullable=False, default=0)
    last_email_sent_at = Column(DateTime(timezone=True), nullable=True)
    last_sent_body     = Column(Text, nullable=True)  # body_markdown as of the last send, for dedup


class ThemeRun(Base):
    """
    Output of the Sector Thesis Scout agent: one global weekly "market-trends
    newsletter" for Tunisia. Each run scans the whole startup/comparables DB
    (sector scores, counts, failure tallies), ranks a set of investment theses,
    diffs the deterministic snapshot against the previous run ("what changed"),
    and drafts a newsletter. Global (not per-investor); stored for in-app reading
    and, when the email seam is activated, sent to every investor.
    """
    __tablename__ = "theme_runs"

    id            = Column(Integer, primary_key=True, index=True)
    period_start  = Column(Text, nullable=False)   # ISO date — Monday of the covered week
    period_end    = Column(Text, nullable=False)   # ISO date — Sunday of the covered week
    generated_at  = Column(DateTime(timezone=True), server_default=func.now())
    subject       = Column(Text, nullable=False)   # newsletter subject
    body_markdown = Column(Text, nullable=False)   # newsletter content (markdown)
    theses_json   = Column(Text, nullable=False, default="[]")  # ranked theses
    summary_json  = Column(Text, nullable=False, default="{}")  # deterministic DB snapshot (for diffing)
    diff_json     = Column(Text, nullable=False, default="[]")  # "what changed" bullets vs previous run
    source        = Column(Text, nullable=False, default="ollama")  # "ollama" | "fallback"
    read          = Column(Boolean, nullable=False, default=False)


# ── Chat History ──────────────────────────────────────────────────────────────

class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id          = Column(Integer, primary_key=True, index=True)
    investor_id = Column(Integer, ForeignKey("investors.id"), nullable=False)
    title       = Column(Text, nullable=False, default="New Chat")
    created_at  = Column(DateTime(timezone=True), server_default=func.now())
    updated_at  = Column(DateTime(timezone=True), server_default=func.now())


class ChatMessageRecord(Base):
    __tablename__ = "chat_message_records"

    id         = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("chat_sessions.id"), nullable=False)
    role       = Column(Text, nullable=False)   # "user" or "assistant"
    content    = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


# ── Chat Persistent Memory (Ollama-only context drop-in) ──────────────────────

class ChatMemoryItem(Base):
    """A single saved reference item (template or free-text context) the local
    LLM is reminded of on every message while its section is enabled."""
    __tablename__ = "chat_memory_items"

    id          = Column(Integer, primary_key=True, index=True)
    investor_id = Column(Integer, ForeignKey("investors.id"), nullable=False, index=True)
    section     = Column(Text, nullable=False)   # pv_template | board_minutes | general_context
    title       = Column(Text, nullable=False)
    content     = Column(Text, nullable=False)
    enabled     = Column(Boolean, nullable=False, default=True)
    created_at  = Column(DateTime(timezone=True), server_default=func.now())
    updated_at  = Column(DateTime(timezone=True), server_default=func.now())


class ChatMemorySection(Base):
    """Per-(investor, section) enabled flag for the persistent memory drop-in."""
    __tablename__ = "chat_memory_sections"

    id          = Column(Integer, primary_key=True, index=True)
    investor_id = Column(Integer, ForeignKey("investors.id"), nullable=False, index=True)
    section     = Column(Text, nullable=False)
    enabled     = Column(Boolean, nullable=False, default=True)


# ── Mode 2 Assessment History ─────────────────────────────────────────────────

class Mode2Assessment(Base):
    """A saved Mode 2 (Assess) run: extracted profile(s), analogues, and the
    AI-generated viability verdict(s), so investors can revisit past assessments."""
    __tablename__ = "mode2_assessments"

    id               = Column(Integer, primary_key=True, index=True)
    investor_id      = Column(Integer, ForeignKey("investors.id"), nullable=False, index=True)
    created_at       = Column(DateTime(timezone=True), server_default=func.now())
    title            = Column(Text, nullable=False)
    is_multiple      = Column(Boolean, nullable=False, default=False)
    profile_json     = Column(Text, nullable=False)   # profile (single) or profiles[] (multi)
    analogues_json   = Column(Text, nullable=True)
    verdict_json     = Column(Text, nullable=True)
    source_filenames = Column(Text, nullable=True)     # JSON list of uploaded filenames


class Mode2Job(Base):
    """A background job for a long-running (Ollama-backed) Mode 2 step, so the
    frontend can poll for completion across page reloads instead of holding the
    request open."""
    __tablename__ = "mode2_jobs"

    id          = Column(Integer, primary_key=True, index=True)
    investor_id = Column(Integer, ForeignKey("investors.id"), nullable=False, index=True)
    job_type    = Column(Text, nullable=False)    # "extract" | "verdict" | "multi_verdict"
    status      = Column(Text, nullable=False, default="pending")  # pending | done | error
    result_json = Column(Text, nullable=True)
    error       = Column(Text, nullable=True)
    created_at  = Column(DateTime(timezone=True), server_default=func.now())
    updated_at  = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


# ─────────────────────────────────────────────────────────────────────────────

class Startup(Base):
    __tablename__ = "startups"

    id                         = Column(Integer, primary_key=True, index=True)
    name                       = Column(Text, nullable=False)
    country                    = Column(Text, nullable=False)
    region                     = Column(Text, nullable=False)
    sector                     = Column(Text, nullable=False)
    sub_sector                 = Column(Text, nullable=True)
    stage                      = Column(Text, nullable=False)
    founded_year               = Column(Integer, nullable=False)
    age_years                  = Column(Float, nullable=False)
    employees                  = Column(Integer, nullable=False)
    annual_revenue_usd         = Column(Float, nullable=True)
    revenue_cagr_3y            = Column(Float, nullable=True)
    ebitda_margin              = Column(Float, nullable=True)
    total_addressable_market_M = Column(Float, nullable=True)
    market_growth_rate         = Column(Float, nullable=True)
    competition_intensity      = Column(Float, nullable=True)
    regulatory_stability       = Column(Float, nullable=True)
    debt_to_ebitda             = Column(Float, nullable=True)
    current_ratio              = Column(Float, nullable=True)
    local_infrastructure       = Column(Float, nullable=True)
    esg_score                  = Column(Float, nullable=True)
    business_model             = Column(Text, nullable=False)
    tech_enabled               = Column(Boolean, nullable=False)
    exit_status                = Column(Text, nullable=False)
    failure_reason             = Column(Text, nullable=True)
    description                = Column(Text, nullable=True)
    tags                       = Column(Text, nullable=True)
