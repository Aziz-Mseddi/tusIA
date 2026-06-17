"""
Portfolio Watchdog — autonomous weekly agent.

Promotes the deterministic, per-investment `_run_checks` engine into a scheduled
agent that scans every investment an investor holds, clusters the co-occurring
signals into root-cause findings, prioritises them, and drafts a weekly
"action list" email. The result is stored as a WeeklyDigest (not emailed).

Reasoning is done by the local Ollama/Qwen model; if it is unreachable the agent
falls back to a deterministic template so the weekly job never fails.
"""
import json
import textwrap
from datetime import date, timedelta

from sqlalchemy.orm import Session

from models import (
    ContractClause, Expenditure, FundAllocation,
    Investment, Investor, MonitoringAlert, PlanMilestone, WeeklyDigest,
)
# Reuse the deterministic engine. monitoring.py does NOT import this module,
# so there is no circular import.
from routers.monitoring import (
    _run_checks, _compute_fund_flow, _detect_suspicious_patterns, _safe_days_to,
    LIQUIDITY_CLAUSE_TYPES,
)
from services.ollama_service import extract_json

SEVERITY_RANK = {"CRITICAL": 4, "ALERT": 3, "WARNING": 2, "INFO": 1}


# ══════════════════════════════════════════════════════════════════════════════
# PERIOD HELPERS
# ══════════════════════════════════════════════════════════════════════════════

def _current_period(today: date | None = None) -> tuple[str, str]:
    """Return (Monday, Sunday) ISO dates for the week containing `today`."""
    today = today or date.today()
    start = today - timedelta(days=today.weekday())
    end = start + timedelta(days=6)
    return start.isoformat(), end.isoformat()


# ══════════════════════════════════════════════════════════════════════════════
# DEADLINE GATHERING
# ══════════════════════════════════════════════════════════════════════════════

def _collect_deadlines(inv: Investment, db: Session, today: date) -> tuple[list[dict], list[dict]]:
    """
    Split an investment's open (pending/in_progress) clause & milestone deadlines
    into two buckets, relative to `today`:
      - due_this_week: due in the next 7 days (days 0-6, i.e. today through
        today+6), not overdue.
      - heads_up_next_week: due exactly on day 7 — the 1st day of NEXT week's
        review window. Not actionable yet, but flagged now so the investor isn't
        surprised when next week's digest finds it already due.
    Already-overdue items are excluded here — `_run_checks` surfaces those as
    alerts instead.
    """
    due_this_week: list[dict] = []
    heads_up_next_week: list[dict] = []

    items = (
        [("clause", c) for c in db.query(ContractClause).filter(
            ContractClause.investment_id == inv.id,
            ContractClause.due_date.isnot(None),
            ContractClause.status.in_(["pending", "in_progress"]),
        ).all()]
        + [("milestone", m) for m in db.query(PlanMilestone).filter(
            PlanMilestone.investment_id == inv.id,
            PlanMilestone.due_date.isnot(None),
            PlanMilestone.status.in_(["pending", "in_progress"]),
        ).all()]
    )

    for kind, item in items:
        days = _safe_days_to(item.due_date, today)
        if days is None or days < 0:
            continue  # unparsable or already overdue — not our concern here
        entry = {
            "type": kind,
            "id": item.id,
            "description": item.description,
            "due_date": item.due_date,
            "days_until_due": days,
        }
        if kind == "clause":
            entry["clause_type"] = item.clause_type
        if days <= 6:
            if kind == "clause" and item.clause_type in LIQUIDITY_CLAUSE_TYPES:
                entry["exercise_letter_url"] = f"/api/v1/monitoring/clauses/{item.id}/exercise-letter"
            due_this_week.append(entry)
        elif days == 7:
            heads_up_next_week.append(entry)

    return due_this_week, heads_up_next_week


# ══════════════════════════════════════════════════════════════════════════════
# SIGNAL GATHERING
# ══════════════════════════════════════════════════════════════════════════════

def _build_bundles(investor: Investor, db: Session) -> list[dict]:
    """
    Run the deterministic checks across all of the investor's investments and
    assemble one compact "signal bundle" per investment that has open signals.
    Investments with nothing to report are omitted.
    """
    bundles: list[dict] = []
    today = date.today()

    investments = db.query(Investment).filter_by(investor_id=investor.id).all()
    for inv in investments:
        # 1. Fire the rules (writes / refreshes MonitoringAlert rows, dedup'd).
        _run_checks(inv, db)

        # 2. Read back the open (unacknowledged) alerts.
        alerts = db.query(MonitoringAlert).filter(
            MonitoringAlert.investment_id == inv.id,
            MonitoringAlert.acknowledged == False,
        ).order_by(MonitoringAlert.created_at.desc()).all()

        # 3. Recompute the structured fund-flow + pattern signals.
        allocs = db.query(FundAllocation).filter_by(investment_id=inv.id).all()
        exps = db.query(Expenditure).filter_by(investment_id=inv.id).all()
        fund_flow = [r for r in _compute_fund_flow(allocs, exps, inv.stage)
                     if r["status"] != "OK"]
        patterns = _detect_suspicious_patterns(exps, inv.stage)

        # 4. Upcoming deadlines: due this week vs. a heads-up for next week.
        due_this_week, heads_up_next_week = _collect_deadlines(inv, db, today)

        if not alerts and not fund_flow and not patterns and not due_this_week and not heads_up_next_week:
            continue  # nothing to say about this investment

        bundles.append({
            "investment_id": inv.id,
            "investment_name": inv.startup_name,
            "stage": inv.stage,
            "days_remaining": _safe_days_to(inv.contract_end_date, today),
            "alerts": [
                {"triggered_by": a.triggered_by, "severity": a.severity,
                 "message": a.message}
                for a in alerts
            ],
            "fund_flow_issues": [
                {"category": r["category"], "agreed": r["agreed"],
                 "actual": r["actual"], "pct": r["pct"], "status": r["status"],
                 "severity": r["severity"], "missing_receipts": r["missing_receipts"]}
                for r in fund_flow
            ],
            "patterns": [
                {"pattern": p["pattern"], "severity": p["severity"],
                 "description": p["description"], "action": p["action"]}
                for p in patterns
            ],
            "deadlines_this_week": due_this_week,
            "heads_up_next_week": heads_up_next_week,
        })

    return bundles


def _bundle_triggers(bundle: dict) -> list[str]:
    """All signal identifiers in a bundle, for the todo `related_triggers` field."""
    triggers = [a["triggered_by"] for a in bundle["alerts"]]
    triggers += [f"fundflow_{r['category']}" for r in bundle["fund_flow_issues"]]
    triggers += [f"pattern_{p['pattern'].lower()}" for p in bundle["patterns"]]
    triggers += [f"deadline_{d['type']}_{d['id']}" for d in bundle.get("deadlines_this_week", [])]
    return triggers


# ══════════════════════════════════════════════════════════════════════════════
# URGENCY SORTING
# ══════════════════════════════════════════════════════════════════════════════

def _deadline_lookup(bundles: list[dict]) -> dict[str, int]:
    """Map `deadline_<type>_<id>` trigger ids to their `days_until_due`."""
    lookup: dict[str, int] = {}
    for b in bundles:
        for d in b.get("deadlines_this_week", []):
            lookup[f"deadline_{d['type']}_{d['id']}"] = d["days_until_due"]
    return lookup


def _todo_urgency(todo: dict, deadline_lookup: dict[str, int]) -> tuple[int, int]:
    """
    Urgency = (severity rank, closeness of nearest related deadline). Higher is
    more urgent. Severity dominates; among todos of equal severity, the one
    with the soonest deadline (or no deadline at all) is ranked by how many
    days remain — fewer days = more urgent.
    """
    sev = SEVERITY_RANK.get(todo.get("severity"), 0)
    related = todo.get("related_triggers") or []
    days = [deadline_lookup[t] for t in related if t in deadline_lookup]
    min_days = min(days) if days else 999
    return (sev, -min_days)


def _sort_todos_by_urgency(todos: list[dict], bundles: list[dict]) -> list[dict]:
    """
    Re-sort todos most-urgent-first (severity, then nearest deadline) and
    renumber `priority` 1..N. Applied to both the AI-drafted and fallback
    digests so the most urgent item always appears first on the page.
    """
    lookup = _deadline_lookup(bundles)
    sorted_todos = sorted(todos, key=lambda t: _todo_urgency(t, lookup), reverse=True)
    for i, t in enumerate(sorted_todos, start=1):
        t["priority"] = i
    return sorted_todos


def _signal_items(bundle: dict) -> list[dict]:
    """
    Flatten a bundle's four raw signal lists (alerts, fund-flow issues, suspicious
    patterns, deadlines due this week) into uniform `{severity, title, message,
    action, _days}` items, ranked most-urgent-first.

    `title` and `action` are derived generically from the signal's source (not
    free text) so the weekly email can render a heading + "Required Action"
    line per item.

    Ranking mirrors `_todo_urgency`: severity dominates (CRITICAL > … > INFO);
    within the same severity a nearer deadline outranks a non-deadline signal.
    `_days` is the deadline's days-until-due (None for non-deadline signals) and is
    used only for sorting — callers strip it before persisting.
    """
    items: list[dict] = []

    for a in bundle["alerts"]:
        items.append({
            "severity": a["severity"],
            "title": a["triggered_by"].replace("_", " ").upper(),
            "message": a["message"],
            "action": "Review this alert on the dashboard and follow up with the startup.",
            "_days": None,
        })

    for r in bundle["fund_flow_issues"]:
        status = r["status"]
        category = r["category"]
        msg = f"{status.lower()} on '{category}'"
        if r.get("pct") is not None:
            msg += f" ({r['pct']:+.0f}%)"
        if r.get("missing_receipts"):
            msg += f" — {r['missing_receipts']:,.0f} TND in missing receipts"

        if status == "UNAUTHORIZED":
            title = f"UNAUTHORISED ALLOCATION — Category '{category}'"
            action = "Review contract terms and request clarification from the startup."
        elif status in ("OVERSPEND", "MAJOR OVERRUN"):
            title = f"EXPENDITURE ANOMALY — Category '{category}'"
            action = "Request a formal written justification from the startup's accounting officer."
        else:
            title = f"FUND ALLOCATION VARIANCE — Category '{category}'"
            action = "Review the spending variance with the startup."

        items.append({
            "severity": r["severity"] or "WARNING",
            "title": title,
            "message": msg,
            "action": action,
            "_days": None,
        })

        if r.get("missing_receipts"):
            items.append({
                "severity": r["severity"] or "WARNING",
                "title": f"RECEIPT SHORTFALL — Category '{category}'",
                "message": (
                    f"{r['missing_receipts']:,.0f} TND in unsubstantiated receipts "
                    f"for category '{category}'."
                ),
                "action": "Obtain and verify all supporting documentation.",
                "_days": None,
            })

    for p in bundle["patterns"]:
        items.append({
            "severity": p["severity"],
            "title": p["pattern"].replace("_", " ").upper(),
            "message": p["description"],
            "action": p["action"],
            "_days": None,
        })

    for d in bundle.get("deadlines_this_week", []):
        days = d["days_until_due"]
        when = "today" if days == 0 else f"in {days} day(s)"
        msg = f"Due {when} — {d['due_date']}."
        if d.get("exercise_letter_url"):
            action = (
                "A liquidity-clause exercise letter has been drafted for review: "
                f"{d['exercise_letter_url']}"
            )
        else:
            action = "Review and complete before the deadline."
        items.append({
            "severity": "ALERT" if days <= 1 else "WARNING",
            "title": f"UPCOMING DEADLINE — \"{d['description'][:60]}\"",
            "message": msg,
            "action": action,
            "_days": days,
        })

    items.sort(
        key=lambda it: (
            SEVERITY_RANK.get(it["severity"], 0),
            -(it["_days"] if it["_days"] is not None else 999),
        ),
        reverse=True,
    )
    return items


def _bundle_top_severity(bundle: dict) -> str:
    sevs = [a["severity"] for a in bundle["alerts"]]
    sevs += [r["severity"] for r in bundle["fund_flow_issues"] if r["severity"]]
    sevs += [p["severity"] for p in bundle["patterns"]]
    # A deadline due today/tomorrow is at least as urgent as an ALERT; anything
    # else due this week is at least a WARNING.
    for d in bundle.get("deadlines_this_week", []):
        sevs.append("ALERT" if d["days_until_due"] <= 1 else "WARNING")
    if not sevs:
        return "INFO"
    return max(sevs, key=lambda s: SEVERITY_RANK.get(s, 0))


def _build_investment_alerts(bundles: list[dict]) -> list[dict]:
    """
    One ranked sub-section per investment, each carrying its individual alerts
    (most-urgent-first) plus a `severity_counts` breakdown. Investments are ranked
    by their top severity, ties broken by how many alerts they carry. This is the
    structure the "This Week" tab renders (top 5 per investment) and the
    deterministic email mirrors.
    """
    groups: list[dict] = []
    for b in bundles:
        items = _signal_items(b)
        if not items:
            continue
        severity_counts = {"CRITICAL": 0, "ALERT": 0, "WARNING": 0, "INFO": 0}
        for it in items:
            severity_counts[it["severity"]] = severity_counts.get(it["severity"], 0) + 1
        groups.append({
            "investment_id": b["investment_id"],
            "investment_name": b["investment_name"],
            "severity": _bundle_top_severity(b),
            "total": len(items),
            "severity_counts": severity_counts,
            "alerts": [
                {"severity": it["severity"], "title": it["title"],
                 "message": it["message"], "action": it["action"]}
                for it in items
            ],
        })
    groups.sort(key=lambda g: (SEVERITY_RANK.get(g["severity"], 0), g["total"]), reverse=True)
    return groups


_DIVIDER_HEAVY = "═" * 48
_DIVIDER_LIGHT = "─" * 48
_BODY_WIDTH = 58


def _wrap(text: str, indent: str = "   ") -> list[str]:
    if not text:
        return []
    return [indent + line for line in textwrap.wrap(text, width=_BODY_WIDTH)]


def _render_email(investor: Investor, inv_alerts: list[dict], bundles: list[dict], cap: int = 5) -> str:
    """
    Deterministic weekly email: a box-drawn report with one section per
    investment (severity counts header, alerts grouped under CRITICAL/ALERT/
    WARNING/INFO dividers, each with a title + message + "Required Action"
    line), followed by a 'Looking ahead' heads-up block and a footer. Used for
    both the AI and fallback paths so the email always matches the tab.
    """
    lines = [
        _DIVIDER_HEAVY,
        "PORTFOLIO WATCHDOG",
        "Weekly Investment Alert Report",
        _DIVIDER_HEAVY,
        "",
        f"Dear {investor.full_name or 'Investor'},",
        "",
        "This is your weekly portfolio review. Our system has identified",
        f"actionable signals across {len(inv_alerts)} of your active investment(s).",
        "",
        "Alerts are grouped by investment and ranked by severity.",
        "",
    ]

    for rank, g in enumerate(inv_alerts, start=1):
        counts = g["severity_counts"]
        header_parts = [f"Total Open Alerts: {g['total']}"]
        for sev, label in (("CRITICAL", "Critical"), ("ALERT", "Alert"),
                           ("WARNING", "Warnings"), ("INFO", "Info")):
            if counts.get(sev):
                header_parts.append(f"{label}: {counts[sev]}")

        lines.append(_DIVIDER_HEAVY)
        lines.append(f" INVESTMENT #{rank} — {g['investment_name']}")
        lines.append(" " + "  |  ".join(header_parts))
        lines.append(_DIVIDER_HEAVY)
        lines.append("")

        shown = g["alerts"][:cap]
        current_sev = None
        for i, a in enumerate(shown, start=1):
            if a["severity"] != current_sev:
                current_sev = a["severity"]
                lines.append(f"── {current_sev} " + "─" * max(1, 44 - len(current_sev)))
                lines.append("")
            lines.append(f"{i}. {a['title']}")
            lines.extend(_wrap(a["message"]))
            lines.append("")
            lines.extend(_wrap(f"Required Action: {a['action']}"))
            lines.append("")

        hidden = g["total"] - cap
        if hidden > 0:
            lines.append(f"   ... and {hidden} additional alert(s) on this investment.")
            lines.append("   View full report → [View full report in your dashboard]")
            lines.append("")

    lines.append(_DIVIDER_HEAVY)
    lines.append("")

    heads_up = [(b["investment_name"], d)
                for b in bundles for d in b.get("heads_up_next_week", [])]
    if heads_up:
        lines.append("── LOOKING AHEAD ────────────────────────────")
        lines.append("")
        lines.append(
            "These deadlines aren't due this week, but fall on the first day of "
            "next week's review window. They won't show up as 'due this week' "
            "until then, so here's an early heads-up:"
        )
        for inv_name, d in heads_up:
            lines.append(
                f"- {inv_name}: \"{d['description'][:100]}\" — due {d['due_date']} "
                "(1st day of next week, not this week)"
            )
        lines.append("")

    lines.append("This report was generated automatically by Portfolio Watchdog.")
    lines.append("For questions or to adjust your alert preferences, visit your")
    lines.append("dashboard or contact support.")
    lines.append("")
    lines.append(_DIVIDER_LIGHT)
    lines.append("TunisIA Invest | Confidential")
    lines.append(_DIVIDER_LIGHT)

    return "\n".join(lines)


# ══════════════════════════════════════════════════════════════════════════════
# REASONING (Ollama) + DETERMINISTIC FALLBACK
# ══════════════════════════════════════════════════════════════════════════════

_SYSTEM_PROMPT = (
    "You are the Portfolio Watchdog for a Tunisian investment fund. You receive a "
    "JSON array of investments, each with raw monitoring signals: contract/clause "
    "and milestone alerts, fund-flow deviations, suspicious spending patterns, and "
    "upcoming contractual deadlines.\n\n"
    "Each investment may also include:\n"
    "- `deadlines_this_week`: clauses/milestones due in the next 7 days (today "
    "through day 6 from today), not yet overdue.\n"
    "- `heads_up_next_week`: clauses/milestones due exactly on day 7 from today — "
    "the 1st day of NEXT week's review window. These are NOT due this week.\n\n"
    "Your job, for the investor's weekly action list:\n"
    "1. CLUSTER co-occurring signals within the SAME investment into a single "
    "root-cause finding (e.g. '20% overspend + missing receipts + vendor "
    "concentration = likely fund misuse'). Do NOT emit one todo per raw signal.\n"
    "2. Assign each finding a COMBINED severity (CRITICAL, ALERT, WARNING or INFO) "
    "reflecting the signals together, not just the loudest one.\n"
    "3. PRIORITISE: order findings most-urgent-first. Urgency = severity first "
    "(CRITICAL > ALERT > WARNING > INFO); within the same severity, a finding "
    "tied to a deadline due sooner (from `deadlines_this_week`) ranks above one "
    "due later or with no deadline at all. (The `priority` field you assign may "
    "be re-numbered afterwards to enforce this exact ordering.) In `body_markdown`, "
    "GROUP the prioritised list BY INVESTMENT under a header per investment, with "
    "the most-urgent investment (its most-urgent finding) first. Under each "
    "investment show AT MOST 5 actions; if an investment has more than 5, list the "
    "top 5 and add a line '...and N more action(s) on this investment.'\n"
    "4. For each finding write a concrete action the investor should take THIS WEEK.\n"
    "5. Every entry in `deadlines_this_week` MUST be reflected in a todo — fold it "
    "into a clustered finding about the same investment if one exists, otherwise "
    "give it its own todo. NEVER turn a `heads_up_next_week` entry into a todo.\n"
    "5b. If a `deadlines_this_week` entry carries an `exercise_letter_url`, it is a "
    "liquidity-rights clause (put option / drag-along / tag-along / ratchet) whose "
    "exercise window closes within a week. The todo for that finding MUST "
    "explicitly mention that an exercise letter has been drafted for review and "
    "include its URL in the `action` field.\n"
    "6. If ANY investment has `heads_up_next_week` entries, end body_markdown with "
    "a short 'Looking ahead' paragraph that lists them by investment and due "
    "date, explicitly noting these fall on the FIRST DAY of NEXT week's review "
    "(not this week) so the investor has advance notice.\n\n"
    "Return ONLY a JSON object with this exact shape:\n"
    "{\n"
    '  "subject": "<short email subject>",\n'
    '  "body_markdown": "<a short investor email in markdown: a one-line greeting, '
    'a 2-3 sentence summary of the week, the prioritised list, and — if applicable — '
    'the Looking ahead paragraph described in rule 6>",\n'
    '  "todos": [\n'
    "    {\n"
    '      "priority": 1,\n'
    '      "investment_id": <int>,\n'
    '      "investment_name": "<string>",\n'
    '      "title": "<short imperative title>",\n'
    '      "severity": "CRITICAL|ALERT|WARNING|INFO",\n'
    '      "why": "<the clustered reasoning: which signals combine and what they imply>",\n'
    '      "action": "<what to look into / do this week>",\n'
    '      "related_triggers": ["<signal id>", ...]\n'
    "    }\n"
    "  ]\n"
    "}\n"
    "Keep it concise and factual. Do not invent signals that are not in the input."
)


async def _draft_digest(investor: Investor, bundles: list[dict]) -> dict:
    """Ollama reasoning step. Falls back to a deterministic draft on any failure."""
    user_message = (
        f"Investor: {investor.full_name or investor.email}\n"
        f"Investments with open signals: {len(bundles)}\n\n"
        f"Signals JSON:\n{json.dumps(bundles, ensure_ascii=False)}"
    )
    try:
        result = await extract_json(_SYSTEM_PROMPT, user_message, temperature=0.2, think=False)
        if not isinstance(result, dict) or "todos" not in result or "body_markdown" not in result:
            raise ValueError("malformed digest")
        todos = result.get("todos") or []
        # Guarantee every todo carries the structured fields the UI expects.
        for i, t in enumerate(todos, start=1):
            t.setdefault("priority", i)
            t.setdefault("severity", "WARNING")
            t.setdefault("related_triggers", [])
        # Enforce urgency ordering regardless of how the model prioritised things.
        result["todos"] = _sort_todos_by_urgency(todos, bundles)
        result["source"] = "ollama"
        result.setdefault("subject", f"Portfolio Watchdog — Weekly Alert Summary | {date.today():%d %B %Y}")
        result.setdefault("stats", _compute_stats(bundles))
        return result
    except Exception as exc:
        # Any LLM failure (unreachable, timeout, HTTP 5xx e.g. model OOM, malformed
        # output) must degrade to the deterministic digest — this is an unattended
        # agent and the weekly run should never fail because of the model.
        print(f"[WARN] Watchdog LLM draft failed ({type(exc).__name__}: {exc}); using fallback")
        return _fallback_digest(investor, bundles)


def _compute_stats(bundles: list[dict]) -> dict:
    counts = {
        "investments_scanned": len(bundles),
        "CRITICAL": 0, "ALERT": 0, "WARNING": 0, "INFO": 0,
        "deadlines_this_week": 0, "heads_up_next_week": 0,
    }
    for b in bundles:
        counts[_bundle_top_severity(b)] += 1
        counts["deadlines_this_week"] += len(b.get("deadlines_this_week", []))
        counts["heads_up_next_week"] += len(b.get("heads_up_next_week", []))
    return counts


def _fallback_digest(investor: Investor, bundles: list[dict]) -> dict:
    """
    Deterministic digest: one todo per investment with something actionable this
    week (open alerts, fund-flow/pattern issues, or a deadline due in the next 7
    days), sorted most-severe first. Used when Ollama is unavailable.

    An investment whose ONLY news is a deadline on the 1st day of NEXT week's
    review window does not get a todo — it is instead surfaced in a "Looking
    ahead" section so the investor has advance notice without an action item
    that isn't due yet.
    """
    todos = []

    for b in bundles:
        sev = _bundle_top_severity(b)
        n_alerts = len(b["alerts"])
        n_flow = len(b["fund_flow_issues"])
        n_pat = len(b["patterns"])
        deadlines = b.get("deadlines_this_week", [])
        n_deadlines = len(deadlines)

        if n_alerts + n_flow + n_pat + n_deadlines == 0:
            continue  # nothing actionable this week — just a next-week heads-up

        reasons = []
        if n_flow:
            reasons.append(", ".join(
                f"{r['status'].lower()} on '{r['category']}'"
                + (f" ({r['pct']:+.0f}%)" if r["pct"] is not None else "")
                for r in b["fund_flow_issues"]
            ))
        if n_pat:
            reasons.append("; ".join(p["description"] for p in b["patterns"]))
        if n_alerts and not reasons:
            reasons.append(f"{n_alerts} open alert(s) on clauses/milestones")
        if deadlines:
            descs = []
            for d in deadlines:
                when = "due today" if d["days_until_due"] == 0 else f"due in {d['days_until_due']} day(s)"
                desc = f"\"{d['description'][:80]}\" ({when}, {d['due_date']})"
                if d.get("exercise_letter_url"):
                    desc += f" — liquidity clause; drafted exercise letter: {d['exercise_letter_url']}"
                descs.append(desc)
            reasons.append(f"{n_deadlines} deadline(s) due this week: " + "; ".join(descs))
        why = " · ".join(reasons) if reasons else f"{n_alerts} open monitoring alert(s)."

        actions = [p["action"] for p in b["patterns"]]
        if actions:
            action = actions[0]
        elif deadlines:
            action = (
                "Confirm progress with the startup on the upcoming deadline(s) "
                "above and make sure any required evidence is uploaded before "
                "they're due."
            )
        else:
            action = (
                "Review the open alerts on this investment's dashboard and follow up "
                "with the startup before the contract review window."
            )
        todos.append({
            "investment_id": b["investment_id"],
            "investment_name": b["investment_name"],
            "title": f"Review {b['investment_name']} — {n_alerts + n_flow + n_pat + n_deadlines} signal(s)",
            "severity": sev,
            "why": why,
            "action": action,
            "related_triggers": _bundle_triggers(b),
        })

    todos = _sort_todos_by_urgency(todos, bundles)

    return {
        "subject": f"Portfolio Watchdog — Weekly Alert Summary | {date.today():%d %B %Y}",
        "body_markdown": _render_email(investor, _build_investment_alerts(bundles), bundles),
        "todos": todos,
        "stats": _compute_stats(bundles),
        "source": "fallback",
    }


# ══════════════════════════════════════════════════════════════════════════════
# PERSISTENCE
# ══════════════════════════════════════════════════════════════════════════════

def _upsert_digest(investor: Investor, draft: dict, db: Session) -> WeeklyDigest:
    """Write one digest per (investor, week); overwrite if it already exists."""
    period_start, period_end = _current_period()
    digest = db.query(WeeklyDigest).filter(
        WeeklyDigest.investor_id == investor.id,
        WeeklyDigest.period_start == period_start,
    ).first()

    fields = dict(
        period_start=period_start,
        period_end=period_end,
        subject=draft["subject"],
        body_markdown=draft["body_markdown"],
        todos_json=json.dumps(draft["todos"], ensure_ascii=False),
        investment_alerts_json=json.dumps(draft.get("investment_alerts", []), ensure_ascii=False),
        stats_json=json.dumps(draft.get("stats", {}), ensure_ascii=False),
        source=draft.get("source", "ollama"),
    )
    if digest:
        for k, v in fields.items():
            setattr(digest, k, v)
        digest.read = False  # fresh content → resurface as unread
    else:
        digest = WeeklyDigest(investor_id=investor.id, **fields)
        db.add(digest)
    db.commit()
    db.refresh(digest)
    return digest


# ══════════════════════════════════════════════════════════════════════════════
# PUBLIC ENTRY POINTS
# ══════════════════════════════════════════════════════════════════════════════

async def generate_for_investor(investor: Investor, db: Session) -> WeeklyDigest | None:
    """Build, draft and persist this week's digest for one investor.

    Returns None if the investor has no open signals anywhere in their portfolio.
    Used by both the scheduled job and the on-demand `run-now` endpoint.
    """
    bundles = _build_bundles(investor, db)
    if not bundles:
        return None
    draft = await _draft_digest(investor, bundles)
    # The tab and email are driven by the per-investment individual-alert breakdown,
    # not the clustered todos — build it deterministically and render the matching
    # email for both the Ollama and fallback drafts.
    inv_alerts = _build_investment_alerts(bundles)
    draft["investment_alerts"] = inv_alerts
    draft["body_markdown"] = _render_email(investor, inv_alerts, bundles)
    return _upsert_digest(investor, draft, db)


async def run_weekly_watchdog(db: Session) -> int:
    """Scheduled entry point: generate digests for every investor. Returns count."""
    from services.email_service import send_newsletter  # lazy import, mirrors thesis_scout_agent.py
    from routers.monitoring import _mark_email_sent

    written = 0
    investors = db.query(Investor).all()
    for investor in investors:
        try:
            digest = await generate_for_investor(investor, db)
            if digest:
                written += 1
                if send_newsletter([investor.email], digest.subject, digest.body_markdown):
                    _mark_email_sent(digest, db)
        except Exception as exc:  # one investor failing must not abort the run
            db.rollback()
            print(f"[WARN] Watchdog failed for investor {investor.id}: {exc}")
    print(f"[OK] Portfolio Watchdog wrote {written} weekly digest(s)")
    return written
