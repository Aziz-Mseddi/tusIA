import json
import re
from collections import Counter
from datetime import date, datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models import (
    ContractClause, Expenditure, FundAllocation,
    Investment, MonitoringAlert, PlanMilestone, WeeklyDigest,
)
from routers.auth import require_investor
from services.doc_parser import extract_text_from_file, has_meaningful_text
from services.exercise_letter_service import draft_exercise_letter
from services.ollama_service import OllamaTimeoutError, OllamaUnavailableError, extract_json
from services.pdf_service import text_to_pdf_bytes

router = APIRouter(prefix="/api/v1/monitoring", tags=["monitoring"])

# Liquidity-rights clause types extracted from shareholder agreements / OCA
# conventions, as opposed to regular contractual "obligation" clauses.
LIQUIDITY_CLAUSE_TYPES = {"put_option", "drag_along", "tag_along", "ratchet"}


# ══════════════════════════════════════════════════════════════════════════════
# SCHEMAS
# ══════════════════════════════════════════════════════════════════════════════

class InvestmentCreate(BaseModel):
    startup_name: str
    startup_sector: Optional[str] = None
    stage: str = "development"
    contract_start_date: str
    contract_end_date: str
    contract_duration_years: int
    total_amount_tnd: Optional[float] = None
    description: Optional[str] = None


class InvestmentUpdate(BaseModel):
    startup_name: Optional[str] = None
    startup_sector: Optional[str] = None
    stage: Optional[str] = None
    contract_start_date: Optional[str] = None
    contract_end_date: Optional[str] = None
    contract_duration_years: Optional[int] = None
    total_amount_tnd: Optional[float] = None
    description: Optional[str] = None


class ClauseCreate(BaseModel):
    description: str
    due_date: Optional[str] = None


class ClauseUpdate(BaseModel):
    status: Optional[str] = None
    evidence_note: Optional[str] = None
    due_date: Optional[str] = None
    description: Optional[str] = None
    clause_type: Optional[str] = None
    trigger_condition: Optional[str] = None
    right_holder: Optional[str] = None
    numbers: Optional[dict] = None


class MilestoneCreate(BaseModel):
    description: str
    due_date: Optional[str] = None


class MilestoneUpdate(BaseModel):
    status: Optional[str] = None
    evidence_note: Optional[str] = None
    due_date: Optional[str] = None
    description: Optional[str] = None


class AllocationCreate(BaseModel):
    category: str
    agreed_amount: float


class ExpenditureCreate(BaseModel):
    category: str
    amount: float
    description: Optional[str] = None
    date: str
    has_receipt: bool = False
    vendor: Optional[str] = None


# ══════════════════════════════════════════════════════════════════════════════
# SERIALISERS
# ══════════════════════════════════════════════════════════════════════════════

def inv_dict(inv: Investment) -> dict:
    return {
        "id": inv.id, "startup_name": inv.startup_name,
        "startup_sector": inv.startup_sector, "stage": inv.stage,
        "contract_start_date": inv.contract_start_date,
        "contract_end_date": inv.contract_end_date,
        "contract_duration_years": inv.contract_duration_years,
        "total_amount_tnd": inv.total_amount_tnd,
        "description": inv.description,
        "created_at": inv.created_at.isoformat() if inv.created_at else None,
    }

def clause_dict(c: ContractClause) -> dict:
    return {
        "id": c.id, "description": c.description, "due_date": c.due_date,
        "status": c.status, "evidence_note": c.evidence_note,
        "fulfilled_at": c.fulfilled_at,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "clause_type": c.clause_type,
        "trigger_condition": c.trigger_condition,
        "right_holder": c.right_holder,
        "numbers": json.loads(c.numbers_json) if c.numbers_json else None,
    }

def milestone_dict(m: PlanMilestone) -> dict:
    return {
        "id": m.id, "description": m.description, "due_date": m.due_date,
        "status": m.status, "evidence_note": m.evidence_note,
        "fulfilled_at": m.fulfilled_at,
        "created_at": m.created_at.isoformat() if m.created_at else None,
    }

def alloc_dict(a: FundAllocation) -> dict:
    return {"id": a.id, "category": a.category, "agreed_amount": a.agreed_amount}

def exp_dict(e: Expenditure) -> dict:
    return {
        "id": e.id, "category": e.category, "amount": e.amount,
        "description": e.description, "date": e.date,
        "has_receipt": e.has_receipt, "vendor": e.vendor,
        "created_at": e.created_at.isoformat() if e.created_at else None,
    }

def alert_dict(a: MonitoringAlert) -> dict:
    return {
        "id": a.id, "triggered_by": a.triggered_by, "severity": a.severity,
        "message": a.message, "recipient": a.recipient,
        "acknowledged": a.acknowledged,
        "created_at": a.created_at.isoformat() if a.created_at else None,
    }

def digest_dict(d: WeeklyDigest, include_body: bool = True) -> dict:
    out = {
        "id": d.id, "period_start": d.period_start, "period_end": d.period_end,
        "generated_at": d.generated_at.isoformat() if d.generated_at else None,
        "subject": d.subject, "source": d.source, "read": d.read,
        "email_sent": d.email_sent,
        "email_sent_count": d.email_sent_count,
        "last_email_sent_at": d.last_email_sent_at.isoformat() if d.last_email_sent_at else None,
        "stats": json.loads(d.stats_json or "{}"),
    }
    if include_body:
        out["body_markdown"] = d.body_markdown
        out["todos"] = json.loads(d.todos_json or "[]")
        out["investment_alerts"] = json.loads(d.investment_alerts_json or "[]")
    return out


def _mark_email_sent(digest: WeeklyDigest, db: Session) -> None:
    """Record a successful send: bumps the weekly counter and snapshots the body
    that was sent, so resends can detect cooldown + no-change duplicates."""
    digest.email_sent = True
    digest.email_sent_count += 1
    digest.last_sent_body = digest.body_markdown
    digest.last_email_sent_at = datetime.now(timezone.utc)
    db.commit()


# Severity ranking shared with the watchdog agent (CRITICAL > ALERT > WARNING > INFO).
_SEVERITY_RANK = {"CRITICAL": 4, "ALERT": 3, "WARNING": 2, "INFO": 1}


def _heads_up_severity(entry: dict) -> str:
    """Best-effort severity for a next-week heads-up deadline (no alert raised yet)."""
    if entry["type"] == "clause":
        return "ALERT" if entry.get("clause_type") in LIQUIDITY_CLAUSE_TYPES else "WARNING"
    return "INFO"


def _heads_up_next_week(investor, db: Session) -> list[dict]:
    """Flat, severity-prioritised list of next week's heads-up deadlines across the portfolio."""
    from services.watchdog_agent import _collect_deadlines  # lazy import avoids circular import

    today = date.today()
    items: list[dict] = []
    for inv in db.query(Investment).filter_by(investor_id=investor.id).all():
        _, heads_up = _collect_deadlines(inv, db, today)
        for entry in heads_up:
            items.append({
                "investment_id": inv.id,
                "investment_name": inv.startup_name,
                "type": entry["type"],
                "description": entry["description"],
                "due_date": entry["due_date"],
                "severity": _heads_up_severity(entry),
            })
    items.sort(key=lambda x: _SEVERITY_RANK.get(x["severity"], 0), reverse=True)
    return items


# ══════════════════════════════════════════════════════════════════════════════
# HELPERS
# ══════════════════════════════════════════════════════════════════════════════

def _get_investment(inv_id: int, investor, db: Session) -> Investment:
    inv = db.query(Investment).filter(
        Investment.id == inv_id, Investment.investor_id == investor.id
    ).first()
    if not inv:
        raise HTTPException(404, "Investment not found")
    return inv


def _compute_fund_flow(allocations, expenditures, stage: str) -> list:
    agreed = {a.category: a.agreed_amount for a in allocations}
    actual: dict = {}
    for e in expenditures:
        actual[e.category] = actual.get(e.category, 0.0) + e.amount

    all_cats = sorted(set(list(agreed.keys()) + list(actual.keys())))
    is_restr = stage == "restructuring"
    rows = []

    for cat in all_cats:
        ag = agreed.get(cat, 0.0)
        ac = actual.get(cat, 0.0)
        delta = ac - ag
        pct = (delta / ag * 100) if ag > 0 else None
        in_contract = cat in agreed

        # Count missing receipts for this category
        no_rcpt = sum(1 for e in expenditures if e.category == cat and not e.has_receipt)

        if not in_contract:
            status, severity = "UNAUTHORIZED", "CRITICAL" if is_restr else "ALERT"
        elif ag == 0:
            status, severity = "OK", None
        elif pct is None:
            status, severity = "OK", None
        elif ac > ag:
            abs_pct = abs(pct)
            if abs_pct < 5:
                status, severity = "MINOR OVERRUN", "INFO"
            elif abs_pct < 20:
                status, severity = "OVERSPEND", "CRITICAL" if is_restr else "WARNING"
            else:
                status, severity = "MAJOR OVERRUN", "CRITICAL" if is_restr else "ALERT"
        elif ac < ag * 0.5 and ag > 0:
            status, severity = "UNDERSPEND", "WARNING"
        else:
            status, severity = "OK", None

        # Escalate if missing receipts on non-OK category
        if no_rcpt > 0 and severity in (None, "INFO"):
            severity = "INFO"

        rows.append({
            "category": cat, "agreed": ag, "actual": ac,
            "delta": round(delta, 2),
            "pct": round(pct, 1) if pct is not None else None,
            "status": status, "severity": severity,
            "in_contract": in_contract,
            "missing_receipts": no_rcpt,
        })
    return rows


def _detect_suspicious_patterns(expenditures, stage: str) -> list:
    """Return list of suspicious pattern dicts for the watchdog."""
    patterns = []
    is_restr = stage == "restructuring"
    base_sev = "ALERT" if is_restr else "WARNING"

    # 1. Same vendor + same amount repeated ≥ 3 times
    if expenditures:
        vendor_amount_pairs = [
            (e.vendor.lower().strip(), e.amount)
            for e in expenditures if e.vendor
        ]
        for (vendor, amount), count in Counter(vendor_amount_pairs).items():
            if count >= 3:
                patterns.append({
                    "severity": base_sev,
                    "pattern": "REPEATED_VENDOR_AMOUNT",
                    "description": (
                        f"Vendor '{vendor}' appears {count}× with identical amount "
                        f"{amount:,.0f} TND (total: {amount*count:,.0f} TND). "
                        f"Verify these are distinct, legitimate transactions."
                    ),
                    "action": "Request individual receipts and purchase orders for each transaction.",
                })

    # 2. Round numbers ≥ 1 000 TND without receipts
    round_no_rcpt = [
        e for e in expenditures
        if not e.has_receipt and e.amount >= 1_000 and e.amount % 500 == 0
    ]
    if round_no_rcpt:
        total = sum(e.amount for e in round_no_rcpt)
        patterns.append({
            "severity": "WARNING" if not is_restr else "ALERT",
            "pattern": "ROUND_AMOUNTS_NO_RECEIPT",
            "description": (
                f"{len(round_no_rcpt)} expenditure(s) with round amounts "
                f"(multiples of 500 TND) totalling {total:,.0f} TND have no receipt. "
                f"Round figures without documentation are a common audit red flag."
            ),
            "action": "Collect and attach receipts or official invoices for all these transactions.",
        })

    # 3. Single vendor represents > 70% of total spend
    if expenditures:
        total_spend = sum(e.amount for e in expenditures)
        if total_spend > 0:
            vendor_totals: dict = {}
            for e in expenditures:
                if e.vendor:
                    k = e.vendor.lower().strip()
                    vendor_totals[k] = vendor_totals.get(k, 0) + e.amount
            for vendor, vendor_total in vendor_totals.items():
                pct = vendor_total / total_spend * 100
                if pct > 70:
                    patterns.append({
                        "severity": "CRITICAL" if is_restr else "ALERT",
                        "pattern": "VENDOR_CONCENTRATION",
                        "description": (
                            f"Vendor '{vendor}' accounts for {pct:.0f}% of all expenditures "
                            f"({vendor_total:,.0f} TND / {total_spend:,.0f} TND total). "
                            f"High vendor concentration is a potential conflict-of-interest signal."
                        ),
                        "action": "Verify arm's-length relationship with vendor and obtain competitive quotes.",
                    })

    # 4. Total missing receipts > 10 000 TND
    no_rcpt = [e for e in expenditures if not e.has_receipt]
    no_rcpt_total = sum(e.amount for e in no_rcpt)
    if no_rcpt_total > 10_000:
        patterns.append({
            "severity": "CRITICAL" if is_restr else "WARNING",
            "pattern": "HIGH_UNVERIFIED_SPEND",
            "description": (
                f"{len(no_rcpt)} transaction(s) totalling {no_rcpt_total:,.0f} TND "
                f"lack supporting receipts. This represents unverified capital deployment."
            ),
            "action": "Obtain receipts from the startup's certified accountant before next audit.",
        })

    return patterns


def _safe_days_to(date_str: str, today: date) -> Optional[int]:
    try:
        return (date.fromisoformat(date_str) - today).days
    except Exception:
        return None


def _alert_exists(db: Session, inv_id: int, trigger: str) -> bool:
    return db.query(MonitoringAlert).filter(
        MonitoringAlert.investment_id == inv_id,
        MonitoringAlert.triggered_by == trigger,
        MonitoringAlert.acknowledged == False,
    ).first() is not None


def _add_alert(db: Session, inv_id: int, trigger: str, severity: str, msg: str, recipient: str = "investor"):
    if not _alert_exists(db, inv_id, trigger):
        db.add(MonitoringAlert(
            investment_id=inv_id, triggered_by=trigger,
            severity=severity, message=msg, recipient=recipient,
        ))


def _run_checks(inv: Investment, db: Session):
    today = date.today()
    try:
        end = date.fromisoformat(inv.contract_end_date)
    except Exception:
        return
    days_left = (end - today).days

    open_clauses = db.query(ContractClause).filter(
        ContractClause.investment_id == inv.id,
        ContractClause.status.in_(["pending", "in_progress"]),
    ).count()
    open_milestones = db.query(PlanMilestone).filter(
        PlanMilestone.investment_id == inv.id,
        PlanMilestone.status.in_(["pending", "in_progress"]),
    ).count()

    # ── Feature 1: Prolongation warnings ─────────────────────────────────────
    # Thresholds ordered most-critical-first so the most urgent alert fires
    # when multiple windows overlap (e.g. 85 days left matches 270 AND 90 —
    # we want the 90-day ALERT, not the 270-day WARNING).
    thresholds = [
        (30,  "1 month",   "CRITICAL"),
        (90,  "3 months",  "ALERT"),
        (180, "6 months",  "WARNING"),
        (270, "9 months",  "WARNING"),
    ]
    for max_days, label, severity in thresholds:
        if 0 < days_left <= max_days and (open_clauses > 0 or open_milestones > 0):
            fiscal_note = (
                "Under the SICAR/FCPR fiscal regime the invested capital was "
                "authorised by tax authorities as an alternative to tax payment. "
                "Failure to fulfil all obligations before expiry may trigger "
                "retroactive fiscal liability for the investor. "
            )
            _add_alert(
                db, inv.id, f"prolongation_{max_days}d", severity,
                f"Contract expiry in {label} — prolongation review required.\n"
                f"Investment: {inv.startup_name} · Expires: {inv.contract_end_date}\n"
                f"Unfulfilled: {open_clauses} clause(s) · {open_milestones} milestone(s)\n"
                f"{fiscal_note}"
                f"Initiate a prolongation request before {end.strftime('%d %B %Y')} "
                f"and contact your legal advisor immediately.",
                recipient="investor",
            )
            break

    # ── Feature 2: Overdue clauses ────────────────────────────────────────────
    for clause in db.query(ContractClause).filter(
        ContractClause.investment_id == inv.id,
        ContractClause.due_date.isnot(None),
        ContractClause.status.in_(["pending", "in_progress"]),
    ).all():
        try:
            if date.fromisoformat(clause.due_date) < today:
                _add_alert(
                    db, inv.id, f"overdue_clause_{clause.id}", "WARNING",
                    f"Contract clause overdue: \"{clause.description[:100]}\" "
                    f"was due on {clause.due_date} and has not been fulfilled. "
                    f"This may constitute a breach of the investment pact.",
                )
                # Auto-mark status
                if clause.status == "pending":
                    clause.status = "overdue"
        except Exception:
            pass

    # ── Feature 2: At-risk clauses (due within 30d, no evidence) ─────────────
    for clause in db.query(ContractClause).filter(
        ContractClause.investment_id == inv.id,
        ContractClause.due_date.isnot(None),
        ContractClause.status.in_(["pending", "in_progress"]),
        ContractClause.evidence_note.is_(None),
    ).all():
        try:
            days_to_due = (date.fromisoformat(clause.due_date) - today).days
            if 0 < days_to_due <= 30:
                _add_alert(
                    db, inv.id, f"atrisk_clause_{clause.id}", "WARNING",
                    f"Clause at risk: \"{clause.description[:100]}\" is due in "
                    f"{days_to_due} day(s) ({clause.due_date}) and has no evidence uploaded. "
                    f"Upload supporting documentation now.",
                )
        except Exception:
            pass

    # ── Feature 2: Overdue milestones ────────────────────────────────────────
    for ms in db.query(PlanMilestone).filter(
        PlanMilestone.investment_id == inv.id,
        PlanMilestone.due_date.isnot(None),
        PlanMilestone.status.in_(["pending", "in_progress"]),
    ).all():
        try:
            if date.fromisoformat(ms.due_date) < today:
                _add_alert(
                    db, inv.id, f"overdue_milestone_{ms.id}", "WARNING",
                    f"Plan milestone overdue: \"{ms.description[:100]}\" "
                    f"was due on {ms.due_date} and has not been achieved.",
                )
                if ms.status == "pending":
                    ms.status = "overdue"
        except Exception:
            pass

    # ── Feature 3: Fund flow deviations ──────────────────────────────────────
    allocs = db.query(FundAllocation).filter_by(investment_id=inv.id).all()
    exps   = db.query(Expenditure).filter_by(investment_id=inv.id).all()
    is_restr = inv.stage == "restructuring"

    if allocs or exps:
        rows = _compute_fund_flow(allocs, exps, inv.stage)
        for row in rows:
            cat = row["category"]
            ag, ac = row["agreed"], row["actual"]

            if row["status"] == "UNAUTHORIZED":
                _add_alert(
                    db, inv.id, f"unauthorized_cat_{cat}", row["severity"],
                    f"Fiscal violation — unauthorised expenditure category.\n"
                    f"{ac:,.0f} TND spent in '{cat}' which is NOT listed in the "
                    f"authorised investment contract. "
                    f"Under the SICAR/FCPR regime, capital must be deployed exactly "
                    f"as declared to the tax authorities (DGI). Unauthorised spending "
                    f"may invalidate the investor's fiscal exemption and trigger "
                    f"retroactive tax recovery. Immediate legal and accounting review required.",
                )
            elif row["status"] in ("MAJOR OVERRUN", "OVERSPEND") and row["pct"] is not None:
                thresh = 5 if is_restr else 15
                if abs(row["pct"]) >= thresh:
                    action = (
                        "Request a formal written justification from the startup's accountant."
                        if not is_restr else
                        "Suspend further disbursements until deviation is explained and approved."
                    )
                    _add_alert(
                        db, inv.id, f"overspend_{cat}", row["severity"],
                        f"Anomaly detected: {ac:,.0f} TND spent in '{cat}' "
                        f"vs {ag:,.0f} TND agreed in contract. "
                        f"Delta: {row['pct']:+.1f}%. "
                        f"Action: {action}",
                    )

    # ── Feature 4: Suspicious patterns (restructuring watchdog) ──────────────
    if exps:
        patterns = _detect_suspicious_patterns(exps, inv.stage)
        for p in patterns:
            trigger = f"pattern_{p['pattern'].lower()}_{inv.id}"
            sev_map = {"CRITICAL": 4, "ALERT": 3, "WARNING": 2, "INFO": 1}
            if not _alert_exists(db, inv.id, trigger):
                msg = (
                    f"Suspicious pattern detected"
                    + (" — Restructuring phase" if is_restr else "")
                    + f"\nPattern: {p['pattern'].replace('_',' ').title()}\n"
                    + p["description"]
                    + f"\nRecommended action: {p['action']}"
                )
                _add_alert(db, inv.id, trigger, p["severity"], msg)

    # ── Feature 3: Missing receipts aggregate ─────────────────────────────────
    no_rcpt_exps = [e for e in exps if not e.has_receipt]
    no_rcpt_total = sum(e.amount for e in no_rcpt_exps)
    if no_rcpt_total > 5_000:
        _add_alert(
            db, inv.id, f"missing_receipts_{inv.id}", "WARNING",
            f"Missing receipts — fiscal documentation gap.\n"
            f"{len(no_rcpt_exps)} expenditure(s) totalling {no_rcpt_total:,.0f} TND "
            f"have no receipt attached. Under Tunisian fiscal law (SICAR/FCPR regime) "
            f"all capital deployment must be documented for DGI audit. "
            f"Undocumented spending weakens the investor's fiscal defence. "
            f"Collect receipts or invoices from the certified accountant without delay.",
        )

    db.commit()


# ══════════════════════════════════════════════════════════════════════════════
# INVESTMENT CRUD
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/investments")
def list_investments(investor=Depends(require_investor), db: Session = Depends(get_db)):
    investments = db.query(Investment).filter_by(investor_id=investor.id).all()
    result = []
    for inv in investments:
        d = inv_dict(inv)
        try:
            d["days_remaining"] = (date.fromisoformat(inv.contract_end_date) - date.today()).days
        except Exception:
            d["days_remaining"] = None
        d["unacknowledged_alerts"] = db.query(MonitoringAlert).filter(
            MonitoringAlert.investment_id == inv.id,
            MonitoringAlert.acknowledged == False,
        ).count()
        result.append(d)
    return {"investments": result}


@router.post("/investments", status_code=201)
def create_investment(req: InvestmentCreate, investor=Depends(require_investor), db: Session = Depends(get_db)):
    inv = Investment(investor_id=investor.id, **req.model_dump())
    db.add(inv)
    db.commit()
    db.refresh(inv)
    return inv_dict(inv)


@router.put("/investments/{inv_id}")
def update_investment(inv_id: int, req: InvestmentUpdate, investor=Depends(require_investor), db: Session = Depends(get_db)):
    inv = _get_investment(inv_id, investor, db)
    for k, v in req.model_dump(exclude_none=True).items():
        setattr(inv, k, v)
    db.commit()
    return inv_dict(inv)


@router.delete("/investments/{inv_id}", status_code=204)
def delete_investment(inv_id: int, investor=Depends(require_investor), db: Session = Depends(get_db)):
    inv = _get_investment(inv_id, investor, db)
    for model in [ContractClause, PlanMilestone, FundAllocation, Expenditure, MonitoringAlert]:
        db.query(model).filter_by(investment_id=inv_id).delete()
    db.delete(inv)
    db.commit()


def _timeline_events_for_investment(inv: Investment, clauses, milestones, exps, alerts, fund_flow) -> list:
    """Build TimelineEvent-shaped dicts for one investment's clauses, milestones,
    expenditures, and alerts — shared by the global portfolio timeline and the
    per-investment calendar."""
    events: list = []
    severity_by_category = {row["category"]: row["severity"] for row in fund_flow}

    for c in clauses:
        if c.due_date:
            events.append({
                "id": f"clause-{c.id}", "type": "clause", "investment_id": inv.id,
                "startup_name": inv.startup_name, "title": c.description,
                "date": c.due_date, "status": c.status,
                "clause_type": c.clause_type,
            })

    for m in milestones:
        if m.due_date:
            events.append({
                "id": f"milestone-{m.id}", "type": "milestone", "investment_id": inv.id,
                "startup_name": inv.startup_name, "title": m.description,
                "date": m.due_date, "status": m.status,
            })

    for e in exps:
        label = e.description or e.vendor or e.category
        events.append({
            "id": f"fundflow-{e.id}", "type": "fund_flow", "investment_id": inv.id,
            "startup_name": inv.startup_name, "title": f"{e.category} — {label}",
            "date": e.date, "category": e.category, "amount": e.amount,
            "severity": severity_by_category.get(e.category),
        })

    for a in alerts:
        events.append({
            "id": f"alert-{a.id}", "type": "alert", "investment_id": inv.id,
            "startup_name": inv.startup_name, "title": a.message[:140],
            "date": (a.created_at.date().isoformat() if a.created_at else date.today().isoformat()),
            "severity": a.severity, "acknowledged": a.acknowledged,
        })

    return events


# ══════════════════════════════════════════════════════════════════════════════
# DASHBOARD
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/investments/{inv_id}/dashboard")
def get_dashboard(inv_id: int, investor=Depends(require_investor), db: Session = Depends(get_db)):
    inv = _get_investment(inv_id, investor, db)
    _run_checks(inv, db)

    clauses    = db.query(ContractClause).filter_by(investment_id=inv_id).all()
    milestones = db.query(PlanMilestone).filter_by(investment_id=inv_id).all()
    allocs     = db.query(FundAllocation).filter_by(investment_id=inv_id).all()
    exps       = db.query(Expenditure).filter_by(investment_id=inv_id).all()
    alerts     = db.query(MonitoringAlert).filter_by(investment_id=inv_id)\
                   .order_by(MonitoringAlert.created_at.desc()).all()

    try:
        days_left = (date.fromisoformat(inv.contract_end_date) - date.today()).days
    except Exception:
        days_left = None

    fund_flow = _compute_fund_flow(allocs, exps, inv.stage)
    patterns  = _detect_suspicious_patterns(exps, inv.stage)

    today = date.today()
    at_risk_clauses = []
    for c in clauses:
        if not c.due_date or c.status in ("fulfilled",):
            continue
        days = _safe_days_to(c.due_date, today)
        if days is not None and 0 < days <= 30:
            at_risk_clauses.append(c)

    at_risk_milestones = []
    for m in milestones:
        if not m.due_date or m.status in ("fulfilled",):
            continue
        days = _safe_days_to(m.due_date, today)
        if days is not None and 0 < days <= 30:
            at_risk_milestones.append(m)

    total_agreed = sum(a.agreed_amount for a in allocs)
    total_actual = sum(e.amount for e in exps)
    no_rcpt_total = sum(e.amount for e in exps if not e.has_receipt)

    calendar_events = _timeline_events_for_investment(inv, clauses, milestones, exps, alerts, fund_flow)
    calendar_events.sort(key=lambda ev: ev["date"] or "")

    return {
        "investment": inv_dict(inv),
        "days_remaining": days_left,
        "clauses":     [clause_dict(c) for c in clauses],
        "milestones":  [milestone_dict(m) for m in milestones],
        "allocations": [alloc_dict(a) for a in allocs],
        "expenditures":[exp_dict(e) for e in exps],
        "fund_flow":   fund_flow,
        "alerts":      [alert_dict(a) for a in alerts],
        "suspicious_patterns": patterns,
        "calendar_events": calendar_events,
        "at_risk": {
            "clauses":    [clause_dict(c) for c in at_risk_clauses],
            "milestones": [milestone_dict(m) for m in at_risk_milestones],
        },
        "stats": {
            "total_clauses":         len(clauses),
            "fulfilled_clauses":     sum(1 for c in clauses if c.status == "fulfilled"),
            "overdue_clauses":       sum(1 for c in clauses if c.status == "overdue"),
            "at_risk_clauses":       len(at_risk_clauses),
            "total_milestones":      len(milestones),
            "fulfilled_milestones":  sum(1 for m in milestones if m.status == "fulfilled"),
            "overdue_milestones":    sum(1 for m in milestones if m.status == "overdue"),
            "at_risk_milestones":    len(at_risk_milestones),
            "unacknowledged_alerts": sum(1 for a in alerts if not a.acknowledged),
            "total_agreed_tnd":      round(total_agreed, 2),
            "total_actual_tnd":      round(total_actual, 2),
            "unverified_spend_tnd":  round(no_rcpt_total, 2),
            "suspicious_patterns":   len(patterns),
        },
    }


# ══════════════════════════════════════════════════════════════════════════════
# PORTFOLIO OVERVIEW (Global Investments Dashboard)
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/portfolio/overview")
def portfolio_overview(investor=Depends(require_investor), db: Session = Depends(get_db)):
    investments = db.query(Investment).filter_by(investor_id=investor.id).all()
    today = date.today()

    timeline: list = []
    inv_summaries: list = []

    clause_stats = {"total": 0, "pending": 0, "in_progress": 0, "overdue": 0, "fulfilled": 0, "at_risk": 0}
    milestone_stats = {"total": 0, "pending": 0, "in_progress": 0, "overdue": 0, "fulfilled": 0, "at_risk": 0}
    suspicious_total = 0

    for inv in investments:
        _run_checks(inv, db)

        clauses    = db.query(ContractClause).filter_by(investment_id=inv.id).all()
        milestones = db.query(PlanMilestone).filter_by(investment_id=inv.id).all()
        allocs     = db.query(FundAllocation).filter_by(investment_id=inv.id).all()
        exps       = db.query(Expenditure).filter_by(investment_id=inv.id).all()
        alerts     = db.query(MonitoringAlert).filter_by(investment_id=inv.id)\
                       .order_by(MonitoringAlert.created_at.desc()).all()

        fund_flow = _compute_fund_flow(allocs, exps, inv.stage)
        patterns  = _detect_suspicious_patterns(exps, inv.stage)

        for c in clauses:
            clause_stats["total"] += 1
            if c.status in clause_stats:
                clause_stats[c.status] += 1
            if c.due_date and c.status != "fulfilled":
                days = _safe_days_to(c.due_date, today)
                if days is not None and 0 < days <= 30:
                    clause_stats["at_risk"] += 1

        for m in milestones:
            milestone_stats["total"] += 1
            if m.status in milestone_stats:
                milestone_stats[m.status] += 1
            if m.due_date and m.status != "fulfilled":
                days = _safe_days_to(m.due_date, today)
                if days is not None and 0 < days <= 30:
                    milestone_stats["at_risk"] += 1

        timeline.extend(_timeline_events_for_investment(inv, clauses, milestones, exps, alerts, fund_flow))

        suspicious_total += len(patterns)

        d = inv_dict(inv)
        try:
            d["days_remaining"] = (date.fromisoformat(inv.contract_end_date) - today).days
        except Exception:
            d["days_remaining"] = None
        d["unacknowledged_alerts"] = sum(1 for a in alerts if not a.acknowledged)
        d["clauses"]    = [clause_dict(c) for c in clauses]
        d["milestones"] = [milestone_dict(m) for m in milestones]
        d["fund_flow"]  = fund_flow
        inv_summaries.append(d)

    timeline.sort(key=lambda e: e["date"] or "")

    return {
        "investments": inv_summaries,
        "timeline": timeline,
        "summary": {
            "clauses": clause_stats,
            "milestones": milestone_stats,
            "at_risk_total": clause_stats["at_risk"] + milestone_stats["at_risk"],
            "suspicious_patterns_count": suspicious_total,
        },
    }


# ══════════════════════════════════════════════════════════════════════════════
# AI DOCUMENT EXTRACTION
# ══════════════════════════════════════════════════════════════════════════════

# qwen3.6 has a 256k context and ollama_service now requests num_ctx=16384, so
# there's room for far more than the old 4-5k char slice — which often cut
# documents off before the page containing the actual clauses/milestones/budget.
EXTRACTION_TEXT_LIMIT = 16000

_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _clean_due_date(value) -> Optional[str]:
    """Keep only well-formed ISO dates; drop hallucinated formats (e.g. 'Q2 2025')."""
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value if _ISO_DATE_RE.match(value) else None


def _no_text_response(text: str, list_key: str) -> dict:
    """
    Standard response when the uploaded file yielded no usable text — most
    often a scanned/image-only PDF that pdfplumber can't read. Feeding the LLM
    near-empty input produces hallucinated or silently-empty results with no
    explanation, so short-circuit before that happens.
    """
    return {
        "source": "no_text_extracted",
        "extracted_count": 0,
        list_key: [],
        "error": (
            "No readable text found in this file. If it's a scanned/image PDF, "
            "it needs OCR before AI extraction can work."
        ),
        "raw_text_preview": text[:500],
    }


@router.post("/investments/{inv_id}/extract-clauses")
async def extract_clauses_from_doc(
    inv_id: int,
    file: UploadFile = File(...),
    investor=Depends(require_investor),
    db: Session = Depends(get_db),
):
    _get_investment(inv_id, investor, db)
    content = await file.read()
    try:
        text = extract_text_from_file(file.filename, content)
    except ValueError as e:
        raise HTTPException(400, str(e))

    if not has_meaningful_text(text):
        return _no_text_response(text, "clauses")

    system = (
        "You are a legal document parser specialising in investment pacts "
        "(pactes d'investissement) for Tunisian SMEs, often written in French. "
        "Extract every contractual obligation the startup/SME (the investee) "
        "must fulfill — financial covenants, reporting duties, hiring "
        "commitments, certifications, operational targets, restrictions on "
        "dividends, audit requirements, etc. Do NOT extract obligations of the "
        "investor.\n\n"
        "Return ONLY a JSON array (no wrapper object, no prose). Each item:\n"
        '  {"description": "<short English summary of the obligation>", '
        '"due_date": "<YYYY-MM-DD, or null if no date is stated>"}\n\n'
        "Example:\n"
        'Input excerpt: "Article 3 - La Societe recrutera un Directeur '
        'Financier qualifie avant le 30/06/2025."\n'
        'Output: [{"description": "Recruit a qualified Chief Financial Officer", '
        '"due_date": "2025-06-30"}]\n\n'
        "If the document contains no such obligations, return []."
    )
    try:
        raw = await extract_json(
            system, f"Investment pact document:\n\n{text[:EXTRACTION_TEXT_LIMIT]}",
            temperature=0.0, think=False,
        )
        items = raw if isinstance(raw, list) else raw.get("clauses", raw.get("items", []))
        created = []
        for item in items[:25]:
            if not isinstance(item, dict):
                continue
            desc = str(item.get("description", "")).strip()
            if desc:
                c = ContractClause(
                    investment_id=inv_id,
                    description=desc,
                    due_date=_clean_due_date(item.get("due_date")),
                )
                db.add(c)
                created.append(c)
        db.commit()
        for c in created:
            db.refresh(c)
        return {
            "source": "ai",
            "extracted_count": len(created),
            "clauses": [clause_dict(c) for c in created],
        }
    except (OllamaTimeoutError, OllamaUnavailableError) as e:
        return {
            "source": "ai_unavailable",
            "extracted_count": 0,
            "clauses": [],
            "error": str(e),
            "raw_text_preview": text[:1500],
        }
    except Exception as e:
        return {
            "source": "ai_failed",
            "extracted_count": 0,
            "clauses": [],
            "error": str(e),
            "raw_text_preview": text[:1500],
        }


@router.post("/investments/{inv_id}/extract-liquidity-clauses")
async def extract_liquidity_clauses_from_doc(
    inv_id: int,
    file: UploadFile = File(...),
    investor=Depends(require_investor),
    db: Session = Depends(get_db),
):
    """
    Upload a shareholder agreement / OCA (obligation convertible en actions)
    convention. AI extracts liquidity-rights clauses — put options,
    drag-along/tag-along, ratchets — as structured ContractClause rows
    distinguished by `clause_type`.
    """
    _get_investment(inv_id, investor, db)
    content = await file.read()
    try:
        text = extract_text_from_file(file.filename, content)
    except ValueError as e:
        raise HTTPException(400, str(e))

    if not has_meaningful_text(text):
        return _no_text_response(text, "clauses")

    system = (
        "You are a legal document parser specialising in shareholder agreements "
        "(pactes d'actionnaires) and OCA conventions (obligations convertibles "
        "en actions) for Tunisian SMEs, often written in French. "
        "Extract every liquidity-rights clause that grants a party an option or "
        "right over shares: put options, drag-along clauses, tag-along clauses, "
        "and ratchet (anti-dilution) mechanisms.\n\n"
        "Return ONLY a JSON array (no wrapper object, no prose). Each item:\n"
        '  {"clause_type": "put_option" | "drag_along" | "tag_along" | "ratchet", '
        '"description": "<short English summary of the clause>", '
        '"trigger_condition": "<what event or condition triggers this right, '
        'or null>", '
        '"right_holder": "<who holds/can exercise this right, e.g. \'investor\' '
        'or \'founders\', or null>", '
        '"due_date": "<YYYY-MM-DD exercise window/deadline, or null if none>", '
        '"numbers": {"price": <numeric price per share or valuation, or null>, '
        '"share_count": <numeric number of shares, or null>, '
        '"threshold": <numeric ownership/performance threshold percentage, or null>}}\n\n'
        "Example:\n"
        'Input excerpt: "L\'Investisseur dispose d\'une option de vente (put '
        'option) exercable a tout moment entre le 1er janvier 2027 et le 31 mars '
        '2027, portant sur 1000 actions au prix de 150 TND par action, en cas de '
        'non-atteinte des objectifs de croissance."\n'
        'Output: [{"clause_type": "put_option", '
        '"description": "Investor put option on 1000 shares at 150 TND/share if '
        'growth targets are not met", '
        '"trigger_condition": "Growth targets not achieved", '
        '"right_holder": "investor", '
        '"due_date": "2027-03-31", '
        '"numbers": {"price": 150, "share_count": 1000, "threshold": null}}]\n\n'
        "If a date is given only as a window (e.g. 'between X and Y'), use the "
        "LAST date of the window as due_date. If the document contains no such "
        "clauses, return []."
    )
    try:
        raw = await extract_json(
            system, f"Shareholder agreement / OCA convention:\n\n{text[:EXTRACTION_TEXT_LIMIT]}",
            temperature=0.0, think=False,
        )
        items = raw if isinstance(raw, list) else raw.get("clauses", raw.get("items", []))
        created = []
        for item in items[:25]:
            if not isinstance(item, dict):
                continue
            clause_type = str(item.get("clause_type", "")).strip().lower()
            if clause_type not in LIQUIDITY_CLAUSE_TYPES:
                continue
            desc = str(item.get("description", "")).strip()
            if not desc:
                continue
            numbers = item.get("numbers")
            c = ContractClause(
                investment_id=inv_id,
                description=desc,
                due_date=_clean_due_date(item.get("due_date")),
                clause_type=clause_type,
                trigger_condition=(str(item.get("trigger_condition")).strip()
                                    if item.get("trigger_condition") else None),
                right_holder=(str(item.get("right_holder")).strip()
                               if item.get("right_holder") else None),
                numbers_json=json.dumps(numbers) if isinstance(numbers, dict) else None,
            )
            db.add(c)
            created.append(c)
        db.commit()
        for c in created:
            db.refresh(c)
        return {
            "source": "ai",
            "extracted_count": len(created),
            "clauses": [clause_dict(c) for c in created],
        }
    except (OllamaTimeoutError, OllamaUnavailableError) as e:
        return {
            "source": "ai_unavailable",
            "extracted_count": 0,
            "clauses": [],
            "error": str(e),
            "raw_text_preview": text[:1500],
        }
    except Exception as e:
        return {
            "source": "ai_failed",
            "extracted_count": 0,
            "clauses": [],
            "error": str(e),
            "raw_text_preview": text[:1500],
        }


@router.post("/investments/{inv_id}/extract-milestones")
async def extract_milestones_from_doc(
    inv_id: int,
    file: UploadFile = File(...),
    investor=Depends(require_investor),
    db: Session = Depends(get_db),
):
    _get_investment(inv_id, investor, db)
    content = await file.read()
    try:
        text = extract_text_from_file(file.filename, content)
    except ValueError as e:
        raise HTTPException(400, str(e))

    if not has_meaningful_text(text):
        return _no_text_response(text, "milestones")

    system = (
        "You are a business plan analyst, often working with French-language "
        "documents. Extract every concrete milestone, deliverable, or target "
        "the startup/SME commits to achieve, as described in the plan d'etude "
        "(business study plan) — e.g. product launches, hiring targets, new "
        "sites/branches, revenue or production targets, certifications.\n\n"
        "Return ONLY a JSON array (no wrapper object, no prose). Each item:\n"
        '  {"description": "<short English summary of the milestone>", '
        '"due_date": "<YYYY-MM-DD, or null if no date is stated>"}\n\n'
        "Example:\n"
        'Input excerpt: "Le lancement du produit pilote est prevu pour le '
        'deuxieme trimestre 2025."\n'
        'Output: [{"description": "Launch the pilot product", '
        '"due_date": "2025-06-30"}]\n\n'
        "If a date is given only as a quarter or month/year, use the LAST day "
        "of that period. If the document contains no such milestones, return []."
    )
    try:
        raw = await extract_json(
            system, f"Plan d'etude document:\n\n{text[:EXTRACTION_TEXT_LIMIT]}",
            temperature=0.0, think=False,
        )
        items = raw if isinstance(raw, list) else raw.get("milestones", raw.get("items", []))
        created = []
        for item in items[:25]:
            if not isinstance(item, dict):
                continue
            desc = str(item.get("description", "")).strip()
            if desc:
                m = PlanMilestone(
                    investment_id=inv_id,
                    description=desc,
                    due_date=_clean_due_date(item.get("due_date")),
                )
                db.add(m)
                created.append(m)
        db.commit()
        for m in created:
            db.refresh(m)
        return {
            "source": "ai",
            "extracted_count": len(created),
            "milestones": [milestone_dict(m) for m in created],
        }
    except (OllamaTimeoutError, OllamaUnavailableError) as e:
        return {
            "source": "ai_unavailable",
            "extracted_count": 0,
            "milestones": [],
            "error": str(e),
            "raw_text_preview": text[:1500],
        }
    except Exception as e:
        return {
            "source": "ai_failed",
            "extracted_count": 0,
            "milestones": [],
            "error": str(e),
            "raw_text_preview": text[:1500],
        }


# ══════════════════════════════════════════════════════════════════════════════
# ACCOUNTANT REPORT EXTRACTION (restructuring phase)
# ══════════════════════════════════════════════════════════════════════════════

@router.post("/investments/{inv_id}/extract-allocations")
async def extract_allocations_from_accountant_report(
    inv_id: int,
    file: UploadFile = File(...),
    investor=Depends(require_investor),
    db: Session = Depends(get_db),
):
    """
    Upload a certified accountant's restructuring report (PDF or TXT).
    AI extracts approved budget categories and populates FundAllocation entries.
    Existing categories are updated; new ones are created.
    Existing expenditures outside the extracted categories will be flagged by
    the watchdog as UNAUTHORIZED on the next dashboard load.
    """
    inv = _get_investment(inv_id, investor, db)
    content = await file.read()
    try:
        text = extract_text_from_file(file.filename, content)
    except ValueError as e:
        raise HTTPException(400, str(e))

    if not has_meaningful_text(text):
        return _no_text_response(text, "allocations")

    system = (
        "You are an accountant report analyst specialising in Tunisian SICAR/FCPR "
        "restructuring funds, often working with French-language reports. "
        "Extract every approved budget line item / spending category for the "
        "startup/SME in restructuring from this certified accountant report "
        "(e.g. 'Personnel', 'Equipement', 'Loyer', 'Marketing', 'Matieres premieres').\n\n"
        "Return ONLY a JSON array (no wrapper object, no prose). Each item:\n"
        '  {"category": "<short category name in English>", '
        '"amount": <approved amount as a plain number in TND, no currency symbol or separators>}\n\n'
        "Example:\n"
        'Input excerpt: "Budget Personnel: 45 000 TND ; Equipement: 120.000 DT"\n'
        'Output: [{"category": "Personnel", "amount": 45000}, '
        '{"category": "Equipment", "amount": 120000}]\n\n'
        "Only include items that have an explicit numeric amount in the document. "
        "If none found, return []."
    )
    try:
        raw = await extract_json(
            system, f"Accountant restructuring report:\n\n{text[:EXTRACTION_TEXT_LIMIT]}",
            temperature=0.0, think=False,
        )
        items = raw if isinstance(raw, list) else raw.get("items", raw.get("categories", raw.get("budget", [])))
        created = []
        for item in items[:30]:
            if not isinstance(item, dict):
                continue
            cat = str(item.get("category", "")).strip()
            amt_raw = item.get("amount")
            if not cat or amt_raw is None:
                continue
            try:
                amt = float(amt_raw)
            except (TypeError, ValueError):
                continue
            if amt <= 0:
                continue
            existing = db.query(FundAllocation).filter_by(investment_id=inv_id, category=cat).first()
            if existing:
                existing.agreed_amount = amt
                db.flush()
                created.append(existing)
            else:
                a = FundAllocation(investment_id=inv_id, category=cat, agreed_amount=amt)
                db.add(a)
                db.flush()
                created.append(a)
        db.commit()
        for a in created:
            db.refresh(a)
        return {
            "source": "ai",
            "extracted_count": len(created),
            "allocations": [alloc_dict(a) for a in created],
        }
    except (OllamaTimeoutError, OllamaUnavailableError) as e:
        return {
            "source": "ai_unavailable",
            "extracted_count": 0,
            "allocations": [],
            "error": str(e),
            "raw_text_preview": text[:1500],
        }
    except Exception as e:
        return {
            "source": "ai_failed",
            "extracted_count": 0,
            "allocations": [],
            "error": str(e),
            "raw_text_preview": text[:1500],
        }


# ══════════════════════════════════════════════════════════════════════════════
# CONTRACT CLAUSES
# ══════════════════════════════════════════════════════════════════════════════

@router.post("/investments/{inv_id}/clauses", status_code=201)
def add_clause(inv_id: int, req: ClauseCreate, investor=Depends(require_investor), db: Session = Depends(get_db)):
    _get_investment(inv_id, investor, db)
    c = ContractClause(investment_id=inv_id, **req.model_dump())
    db.add(c)
    db.commit()
    db.refresh(c)
    return clause_dict(c)


@router.patch("/clauses/{clause_id}")
def update_clause(clause_id: int, req: ClauseUpdate, investor=Depends(require_investor), db: Session = Depends(get_db)):
    c = db.query(ContractClause).filter_by(id=clause_id).first()
    if not c:
        raise HTTPException(404, "Clause not found")
    _get_investment(c.investment_id, investor, db)
    data = req.model_dump(exclude_none=True)
    if data.get("status") == "fulfilled" and not c.fulfilled_at:
        data["fulfilled_at"] = date.today().isoformat()
    if "numbers" in data:
        numbers = data.pop("numbers")
        data["numbers_json"] = json.dumps(numbers) if numbers else None
    for k, v in data.items():
        setattr(c, k, v)
    db.commit()
    return clause_dict(c)


@router.delete("/clauses/{clause_id}", status_code=204)
def delete_clause(clause_id: int, investor=Depends(require_investor), db: Session = Depends(get_db)):
    c = db.query(ContractClause).filter_by(id=clause_id).first()
    if not c:
        raise HTTPException(404, "Clause not found")
    _get_investment(c.investment_id, investor, db)
    db.delete(c)
    db.commit()


def _get_liquidity_clause(clause_id: int, investor, db: Session) -> tuple[ContractClause, Investment]:
    c = db.query(ContractClause).filter_by(id=clause_id).first()
    if not c:
        raise HTTPException(404, "Clause not found")
    inv = _get_investment(c.investment_id, investor, db)
    if c.clause_type not in LIQUIDITY_CLAUSE_TYPES:
        raise HTTPException(400, "Exercise letters are only available for liquidity-rights clauses")
    return c, inv


@router.get("/clauses/{clause_id}/exercise-letter")
async def get_exercise_letter(clause_id: int, investor=Depends(require_investor), db: Session = Depends(get_db)):
    c, inv = _get_liquidity_clause(clause_id, investor, db)
    draft = await draft_exercise_letter(c, inv, investor)
    return {**draft, "clause": clause_dict(c)}


@router.get("/clauses/{clause_id}/exercise-letter.pdf")
async def get_exercise_letter_pdf(clause_id: int, investor=Depends(require_investor), db: Session = Depends(get_db)):
    c, inv = _get_liquidity_clause(clause_id, investor, db)
    draft = await draft_exercise_letter(c, inv, investor)
    pdf_bytes = text_to_pdf_bytes(draft["letter_markdown"], title=f"Exercise Letter — {inv.startup_name}")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=exercise_letter_clause_{c.id}.pdf"},
    )


# ══════════════════════════════════════════════════════════════════════════════
# PLAN MILESTONES
# ══════════════════════════════════════════════════════════════════════════════

@router.post("/investments/{inv_id}/milestones", status_code=201)
def add_milestone(inv_id: int, req: MilestoneCreate, investor=Depends(require_investor), db: Session = Depends(get_db)):
    _get_investment(inv_id, investor, db)
    m = PlanMilestone(investment_id=inv_id, **req.model_dump())
    db.add(m)
    db.commit()
    db.refresh(m)
    return milestone_dict(m)


@router.patch("/milestones/{ms_id}")
def update_milestone(ms_id: int, req: MilestoneUpdate, investor=Depends(require_investor), db: Session = Depends(get_db)):
    m = db.query(PlanMilestone).filter_by(id=ms_id).first()
    if not m:
        raise HTTPException(404, "Milestone not found")
    _get_investment(m.investment_id, investor, db)
    data = req.model_dump(exclude_none=True)
    if data.get("status") == "fulfilled" and not m.fulfilled_at:
        data["fulfilled_at"] = date.today().isoformat()
    for k, v in data.items():
        setattr(m, k, v)
    db.commit()
    return milestone_dict(m)


@router.delete("/milestones/{ms_id}", status_code=204)
def delete_milestone(ms_id: int, investor=Depends(require_investor), db: Session = Depends(get_db)):
    m = db.query(PlanMilestone).filter_by(id=ms_id).first()
    if not m:
        raise HTTPException(404, "Milestone not found")
    _get_investment(m.investment_id, investor, db)
    db.delete(m)
    db.commit()


# ══════════════════════════════════════════════════════════════════════════════
# FUND ALLOCATIONS
# ══════════════════════════════════════════════════════════════════════════════

@router.post("/investments/{inv_id}/allocations", status_code=201)
def add_allocation(inv_id: int, req: AllocationCreate, investor=Depends(require_investor), db: Session = Depends(get_db)):
    _get_investment(inv_id, investor, db)
    existing = db.query(FundAllocation).filter_by(investment_id=inv_id, category=req.category).first()
    if existing:
        existing.agreed_amount = req.agreed_amount
        db.commit()
        return alloc_dict(existing)
    a = FundAllocation(investment_id=inv_id, **req.model_dump())
    db.add(a)
    db.commit()
    db.refresh(a)
    return alloc_dict(a)


@router.delete("/allocations/{alloc_id}", status_code=204)
def delete_allocation(alloc_id: int, investor=Depends(require_investor), db: Session = Depends(get_db)):
    a = db.query(FundAllocation).filter_by(id=alloc_id).first()
    if not a:
        raise HTTPException(404, "Allocation not found")
    _get_investment(a.investment_id, investor, db)
    db.delete(a)
    db.commit()


# ══════════════════════════════════════════════════════════════════════════════
# EXPENDITURES
# ══════════════════════════════════════════════════════════════════════════════

@router.post("/investments/{inv_id}/expenditures", status_code=201)
def add_expenditure(inv_id: int, req: ExpenditureCreate, investor=Depends(require_investor), db: Session = Depends(get_db)):
    _get_investment(inv_id, investor, db)
    e = Expenditure(investment_id=inv_id, **req.model_dump())
    db.add(e)
    db.commit()
    db.refresh(e)
    return exp_dict(e)


@router.delete("/expenditures/{exp_id}", status_code=204)
def delete_expenditure(exp_id: int, investor=Depends(require_investor), db: Session = Depends(get_db)):
    e = db.query(Expenditure).filter_by(id=exp_id).first()
    if not e:
        raise HTTPException(404, "Expenditure not found")
    _get_investment(e.investment_id, investor, db)
    db.delete(e)
    db.commit()


# ══════════════════════════════════════════════════════════════════════════════
# ALERTS
# ══════════════════════════════════════════════════════════════════════════════

@router.patch("/alerts/{alert_id}/acknowledge")
def acknowledge_alert(alert_id: int, investor=Depends(require_investor), db: Session = Depends(get_db)):
    a = db.query(MonitoringAlert).filter_by(id=alert_id).first()
    if not a:
        raise HTTPException(404, "Alert not found")
    _get_investment(a.investment_id, investor, db)
    a.acknowledged = True
    db.commit()
    return alert_dict(a)


@router.post("/investments/{inv_id}/run-checks")
def run_checks_endpoint(inv_id: int, investor=Depends(require_investor), db: Session = Depends(get_db)):
    inv = _get_investment(inv_id, investor, db)
    _run_checks(inv, db)
    alerts = db.query(MonitoringAlert).filter_by(investment_id=inv_id)\
               .order_by(MonitoringAlert.created_at.desc()).all()
    return {"alerts": [alert_dict(a) for a in alerts]}


# ══════════════════════════════════════════════════════════════════════════════
# WEEKLY DIGEST (Portfolio Watchdog agent output)
# ══════════════════════════════════════════════════════════════════════════════

def _get_digest(digest_id: int, investor, db: Session) -> WeeklyDigest:
    d = db.query(WeeklyDigest).filter(
        WeeklyDigest.id == digest_id, WeeklyDigest.investor_id == investor.id
    ).first()
    if not d:
        raise HTTPException(404, "Digest not found")
    return d


@router.get("/digests")
def list_digests(investor=Depends(require_investor), db: Session = Depends(get_db)):
    digests = db.query(WeeklyDigest).filter_by(investor_id=investor.id)\
                .order_by(WeeklyDigest.generated_at.desc()).all()
    return {"digests": [digest_dict(d, include_body=False) for d in digests]}


@router.get("/digests/{digest_id}")
def get_digest(digest_id: int, investor=Depends(require_investor), db: Session = Depends(get_db)):
    out = digest_dict(_get_digest(digest_id, investor, db))
    out["heads_up_next_week"] = _heads_up_next_week(investor, db)
    return out


@router.patch("/digests/{digest_id}/read")
def mark_digest_read(digest_id: int, investor=Depends(require_investor), db: Session = Depends(get_db)):
    d = _get_digest(digest_id, investor, db)
    d.read = True
    db.commit()
    return digest_dict(d, include_body=False)


@router.post("/digests/run-now")
async def run_digest_now(investor=Depends(require_investor), db: Session = Depends(get_db)):
    # Lazy import avoids a circular import at module load
    # (watchdog_agent imports the check helpers from this module).
    from services.watchdog_agent import generate_for_investor, _current_period
    from services.email_service import send_newsletter

    period_start, _ = _current_period()
    existing = db.query(WeeklyDigest).filter(
        WeeklyDigest.investor_id == investor.id,
        WeeklyDigest.period_start == period_start,
    ).first()
    prev_subject = existing.subject if existing else None
    prev_body = existing.body_markdown if existing else None
    was_sent = existing.email_sent if existing else False

    digest = await generate_for_investor(investor, db)
    if not digest:
        return {"digest": None, "message": "No open signals across your portfolio this week."}

    changed = digest.subject != prev_subject or digest.body_markdown != prev_body
    if not was_sent or changed:
        if send_newsletter([investor.email], digest.subject, digest.body_markdown):
            _mark_email_sent(digest, db)
    return {"digest": digest_dict(digest)}


RESEND_COOLDOWN_SECONDS = 60


@router.post("/digests/{digest_id}/resend-email")
def resend_digest_email(digest_id: int, investor=Depends(require_investor), db: Session = Depends(get_db)):
    from services.email_service import send_newsletter
    d = _get_digest(digest_id, investor, db)

    if d.last_email_sent_at is not None:
        last_sent = d.last_email_sent_at
        if last_sent.tzinfo is None:
            last_sent = last_sent.replace(tzinfo=timezone.utc)
        elapsed = (datetime.now(timezone.utc) - last_sent).total_seconds()
        if elapsed < RESEND_COOLDOWN_SECONDS:
            return {
                "digest": digest_dict(d, include_body=False),
                "sent": False,
                "reason": "cooldown",
                "retry_after": int(RESEND_COOLDOWN_SECONDS - elapsed),
            }

    if d.email_sent_count >= 2 and d.last_sent_body == d.body_markdown:
        return {"digest": digest_dict(d, include_body=False), "sent": False, "reason": "duplicate"}

    sent = send_newsletter([investor.email], d.subject, d.body_markdown)
    if sent:
        _mark_email_sent(d, db)
        return {"digest": digest_dict(d, include_body=False), "sent": True}
    return {"digest": digest_dict(d, include_body=False), "sent": False, "reason": "smtp_off"}
