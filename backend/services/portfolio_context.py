"""
Builds a compact text summary of an investor's monitoring portfolio — their
investments, open clause/milestone deadlines, fund-flow status, and this
week's Portfolio Watchdog to-do list. Injected into the chat assistant's
system prompt when the user enables the "Portfolio" context toggle, so the
local LLM can answer questions about the investor's own data.
"""
import json
from datetime import date

from sqlalchemy.orm import Session

from models import (
    ContractClause, Expenditure, FundAllocation,
    Investment, Investor, PlanMilestone, WeeklyDigest,
)
from routers.monitoring import _compute_fund_flow, _safe_days_to


def build_portfolio_context(investor: Investor, db: Session) -> str:
    today = date.today()
    investments = db.query(Investment).filter_by(investor_id=investor.id).all()
    if not investments:
        return "The investor currently has no tracked investments in the monitoring portfolio."

    lines = [f"Portfolio overview for {investor.full_name or investor.email} ({len(investments)} investment(s)):"]

    for inv in investments:
        clauses = db.query(ContractClause).filter_by(investment_id=inv.id).all()
        milestones = db.query(PlanMilestone).filter_by(investment_id=inv.id).all()
        allocs = db.query(FundAllocation).filter_by(investment_id=inv.id).all()
        exps = db.query(Expenditure).filter_by(investment_id=inv.id).all()

        days_remaining = _safe_days_to(inv.contract_end_date, today)
        header = (
            f"\n- {inv.startup_name} (id: {inv.id}, sector: {inv.startup_sector or 'n/a'}, "
            f"stage: {inv.stage}): contract {inv.contract_start_date} -> {inv.contract_end_date}"
        )
        if days_remaining is not None:
            header += f", {days_remaining} day(s) remaining"
        if inv.total_amount_tnd:
            header += f", total amount {inv.total_amount_tnd:,.0f} TND"
        lines.append(header)

        lines.append(
            f"  Clauses: {len(clauses)} total "
            f"({sum(1 for c in clauses if c.status == 'fulfilled')} fulfilled, "
            f"{sum(1 for c in clauses if c.status == 'overdue')} overdue, "
            f"{sum(1 for c in clauses if c.status in ('pending', 'in_progress'))} open)"
        )
        lines.append(
            f"  Milestones: {len(milestones)} total "
            f"({sum(1 for m in milestones if m.status == 'fulfilled')} fulfilled, "
            f"{sum(1 for m in milestones if m.status == 'overdue')} overdue, "
            f"{sum(1 for m in milestones if m.status in ('pending', 'in_progress'))} open)"
        )

        if allocs or exps:
            total_agreed = sum(a.agreed_amount for a in allocs)
            total_actual = sum(e.amount for e in exps)
            lines.append(f"  Fund flow: agreed {total_agreed:,.0f} TND, actual {total_actual:,.0f} TND")
            issues = [r for r in _compute_fund_flow(allocs, exps, inv.stage) if r["status"] != "OK"]
            if issues:
                lines.append("  Fund flow issues: " + "; ".join(
                    f"{r['category']} is {r['status']}" for r in issues
                ))

        upcoming = []
        for c in clauses:
            if c.due_date and c.status in ("pending", "in_progress"):
                upcoming.append(("clause", c.description, c.due_date))
        for m in milestones:
            if m.due_date and m.status in ("pending", "in_progress"):
                upcoming.append(("milestone", m.description, m.due_date))
        upcoming.sort(key=lambda x: x[2])
        for kind, desc, due in upcoming[:5]:
            lines.append(f"  - Open {kind} due {due}: {desc[:100]}")

    digest = (
        db.query(WeeklyDigest)
        .filter(WeeklyDigest.investor_id == investor.id)
        .order_by(WeeklyDigest.period_start.desc())
        .first()
    )
    if digest:
        todos = json.loads(digest.todos_json or "[]")
        if todos:
            lines.append(f"\nThis week's prioritised to-do list ({digest.period_start} to {digest.period_end}):")
            for t in todos[:10]:
                lines.append(
                    f"  {t.get('priority')}. [{t.get('severity')}] {t.get('investment_name')}: "
                    f"{t.get('title')} -- {t.get('action')}"
                )

    return "\n".join(lines)
