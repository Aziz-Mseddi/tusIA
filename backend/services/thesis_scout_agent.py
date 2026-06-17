"""
Sector Thesis Scout — autonomous weekly agent.

Generalises the on-demand `/suggestions` endpoint into a scheduled agent. Each run
scans the whole startup/comparables DB for the current market trends (sector scores,
counts, failure tallies), ranks a set of investment theses for Tunisia, attaches a
watchlist of real supporting startups, diffs the deterministic snapshot against the
previous run to surface "what changed", and drafts a market-trends newsletter.

Reasoning is done by the local Ollama/Qwen model; if it is unreachable the agent
falls back to a deterministic draft (ranked theses + diff are computable without the
LLM), so the weekly job never fails.

The newsletter is stored as a `ThemeRun` and surfaced in-app. Delivery is wired
through `email_service.send_newsletter` as an inactive seam (see run_weekly_scout).
"""
import json
from datetime import date, timedelta

from sqlalchemy.orm import Session

from models import Investor, Startup, ThemeRun
# Reuse the shared DB-summary + scoring helpers. routers.mode1 does NOT import this
# module at load time (only lazily inside run-now), so there is no circular import.
from routers.mode1 import build_db_summary, _score_startup
from services.scoring_engine import load_benchmarks_from_db
from services.ollama_service import extract_json

# A sector's average score must move at least this many points to be called out.
SCORE_MOVE_THRESHOLD = 2.0


# ══════════════════════════════════════════════════════════════════════════════
# PERIOD HELPERS
# ══════════════════════════════════════════════════════════════════════════════

def _current_period(today: date | None = None) -> tuple[str, str]:
    """Return (Monday, Sunday) ISO dates for the week containing `today`."""
    today = today or date.today()
    start = today - timedelta(days=today.weekday())
    end = start + timedelta(days=6)
    return start.isoformat(), end.isoformat()


def _risk_from_score(score: float) -> str:
    """Higher investment score → lower risk."""
    if score >= 65:
        return "Low"
    if score >= 50:
        return "Medium"
    return "High"


# ══════════════════════════════════════════════════════════════════════════════
# WATCHLIST (deterministic, grounded in real startups)
# ══════════════════════════════════════════════════════════════════════════════

def _top_startups_by_sector(db: Session) -> dict[str, list[dict]]:
    """Map each sector to its top-scoring still-active startups (name + score)."""
    benchmarks = load_benchmarks_from_db(db)
    by_sector: dict[str, list[dict]] = {}
    for s in db.query(Startup).all():
        if s.exit_status == "failed":
            continue
        score = _score_startup(s, benchmarks)["final_score"]
        by_sector.setdefault(s.sector, []).append({"name": s.name, "score": round(score, 1)})
    for sector, rows in by_sector.items():
        rows.sort(key=lambda r: r["score"], reverse=True)
        by_sector[sector] = rows[:3]
    return by_sector


def _attach_watchlist(theses: list[dict], watch_map: dict[str, list[dict]]) -> None:
    """For each thesis, gather the top startups across its supporting sectors."""
    for t in theses:
        seen: dict[str, dict] = {}
        for sector in t.get("supporting_sectors", []):
            for row in watch_map.get(sector, []):
                # de-dup by name, keep the highest score seen
                if row["name"] not in seen or row["score"] > seen[row["name"]]["score"]:
                    seen[row["name"]] = row
        t["watchlist"] = sorted(seen.values(), key=lambda r: r["score"], reverse=True)[:4]


# ══════════════════════════════════════════════════════════════════════════════
# THESIS RANKING (Ollama) + DETERMINISTIC FALLBACK
# ══════════════════════════════════════════════════════════════════════════════

_RANK_SYSTEM_PROMPT = (
    "You are a private equity analyst specializing in emerging markets similar to Tunisia "
    "(MENA, Sub-Saharan Africa, South/Southeast Asia). You receive a JSON summary of startup "
    "performance across these markets: count and average investment score per sector, the "
    "top sectors, and the failure landscape.\n\n"
    "Produce a RANKED set of investment theses for Tunisia, most compelling first. Favour "
    "sectors with strong average scores and avoid those dominated by failures. "
    "Return ONLY a JSON array with this exact shape:\n"
    '[{"rank": 1, "theme": string, "rationale": string, '
    '"supporting_sectors": string[], "risk_level": "Low"|"Medium"|"High"}]\n'
    "Generate exactly 5 theses, ranked 1 through 5. Use ONLY sectors present in the input. "
    "Be concise and factual; do not invent data."
)


async def _rank_theses(summary: dict) -> tuple[list[dict], str]:
    """Ollama ranking step. Returns (theses, source). Falls back deterministically."""
    try:
        result = await extract_json(
            _RANK_SYSTEM_PROMPT, json.dumps(summary), temperature=0.2, think=False,
        )
        if isinstance(result, dict):
            result = result.get("theses") or result.get("suggestions") or []
        if not isinstance(result, list) or not result:
            raise ValueError("malformed theses")
        # Guarantee the structured fields the UI + diff expect.
        for i, t in enumerate(result, start=1):
            t.setdefault("rank", i)
            t.setdefault("supporting_sectors", [])
            t.setdefault("risk_level", "Medium")
        result.sort(key=lambda t: t.get("rank", 99))
        return result, "ollama"
    except Exception as exc:
        print(f"[WARN] Scout thesis ranking failed ({type(exc).__name__}: {exc}); using fallback")
        return _fallback_theses(summary), "fallback"


def _fallback_theses(summary: dict) -> list[dict]:
    """Deterministic theses from sector scores when Ollama is unavailable."""
    avg = summary.get("avg_score_by_sector", {})
    failures = summary.get("failure_counts_by_sector", {})
    ranked_sectors = sorted(avg, key=lambda s: avg[s], reverse=True)[:5]
    theses = []
    for i, sector in enumerate(ranked_sectors, start=1):
        score = avg[sector]
        nfail = failures.get(sector, 0)
        rationale = (
            f"{sector} leads on average investment score ({score}/100) across comparable "
            f"emerging markets"
            + (f", though {nfail} failure(s) on record warrant diligence." if nfail else ".")
        )
        theses.append({
            "rank": i,
            "theme": f"{sector} in Tunisia",
            "rationale": rationale,
            "supporting_sectors": [sector],
            "risk_level": _risk_from_score(score),
        })
    return theses


# ══════════════════════════════════════════════════════════════════════════════
# DIFF VS PREVIOUS RUN ("what changed")
# ══════════════════════════════════════════════════════════════════════════════

def _norm_title(theme: str) -> str:
    return "".join(ch for ch in (theme or "").lower() if ch.isalnum())


def _diff_vs_last(prev_run: ThemeRun | None, new_summary: dict, new_theses: list[dict]) -> list[str]:
    """
    Human-readable bullets describing how this run differs from the previous one.
    Diffs the DETERMINISTIC snapshot (sector momentum + failures) for robustness,
    plus theses entering/leaving the ranked set.
    """
    if not prev_run:
        return ["First run — no prior period to compare against."]

    try:
        prev_summary = json.loads(prev_run.summary_json or "{}")
        prev_theses = json.loads(prev_run.theses_json or "[]")
    except (TypeError, ValueError):
        prev_summary, prev_theses = {}, []

    bullets: list[str] = []

    # 1. Sector average-score momentum.
    prev_avg = prev_summary.get("avg_score_by_sector", {})
    new_avg = new_summary.get("avg_score_by_sector", {})
    for sector in sorted(new_avg):
        if sector in prev_avg:
            delta = round(new_avg[sector] - prev_avg[sector], 1)
            if abs(delta) >= SCORE_MOVE_THRESHOLD:
                arrow = "↑" if delta > 0 else "↓"
                bullets.append(
                    f"{sector} score {arrow} {abs(delta):g} pts → {new_avg[sector]}/100"
                )
        else:
            bullets.append(f"New sector tracked: {sector} ({new_avg[sector]}/100)")

    # 2. New failures per sector.
    prev_fail = prev_summary.get("failure_counts_by_sector", {})
    new_fail = new_summary.get("failure_counts_by_sector", {})
    for sector in sorted(new_fail):
        delta = new_fail[sector] - prev_fail.get(sector, 0)
        if delta > 0:
            bullets.append(f"{delta} new failure(s) recorded in {sector}")

    # 3. Theses entering / leaving the ranked set.
    prev_titles = {_norm_title(t.get("theme", "")) for t in prev_theses}
    new_titles = {_norm_title(t.get("theme", "")) for t in new_theses}
    for t in new_theses:
        if _norm_title(t.get("theme", "")) not in prev_titles:
            bullets.append(f"New thesis: {t.get('theme')}")
    for t in prev_theses:
        if _norm_title(t.get("theme", "")) not in new_titles:
            bullets.append(f"Dropped thesis: {t.get('theme')}")

    if not bullets:
        bullets.append("No material changes since the previous run.")
    return bullets


# ══════════════════════════════════════════════════════════════════════════════
# NEWSLETTER DRAFTING (Ollama) + DETERMINISTIC FALLBACK
# ══════════════════════════════════════════════════════════════════════════════

_NEWSLETTER_SYSTEM_PROMPT = (
    "You are the Sector Thesis Scout, writing a weekly market-trends newsletter for investors "
    "focused on Tunisia. You receive (a) a ranked list of investment theses with rationale, "
    "supporting sectors and a watchlist of real startups, and (b) a list of changes since last "
    "week.\n\n"
    "Write a concise, factual newsletter in markdown. Return ONLY a JSON object:\n"
    "{\n"
    '  "subject": "<short newsletter subject>",\n'
    '  "body_markdown": "<markdown: a one-line greeting; a \\"What changed this week\\" section '
    'as a bullet list; then the ranked theses, each with its rationale and watchlist>"\n'
    "}\n"
    "Do not invent theses or changes that are not in the input."
)


async def _draft_newsletter(theses: list[dict], diff: list[str]) -> dict:
    """Ollama newsletter draft. Falls back to a deterministic draft on any failure."""
    payload = json.dumps({"theses": theses, "what_changed": diff}, ensure_ascii=False)
    try:
        result = await extract_json(_NEWSLETTER_SYSTEM_PROMPT, payload, temperature=0.3, think=False)
        if not isinstance(result, dict) or "body_markdown" not in result:
            raise ValueError("malformed newsletter")
        result.setdefault("subject", f"Tunisia investment themes — {len(theses)} live theses")
        result["source"] = "ollama"
        return result
    except Exception as exc:
        print(f"[WARN] Scout newsletter draft failed ({type(exc).__name__}: {exc}); using fallback")
        return _fallback_newsletter(theses, diff)


def _fallback_newsletter(theses: list[dict], diff: list[str]) -> dict:
    """Deterministic newsletter when Ollama is unavailable."""
    lines = [
        "Hello,",
        "",
        "Here is this week's Tunisia market-trends digest from your Sector Thesis Scout.",
        "",
        "**What changed this week**",
        "",
    ]
    lines += [f"- {b}" for b in diff]
    lines += ["", "**Ranked investment theses**", ""]
    for t in theses:
        lines.append(f"**{t.get('rank')}. {t.get('theme')}** — _{t.get('risk_level')} risk_")
        lines.append(f"- {t.get('rationale', '')}")
        sectors = ", ".join(t.get("supporting_sectors", []))
        if sectors:
            lines.append(f"- Sectors: {sectors}")
        watch = ", ".join(f"{w['name']} ({w['score']})" for w in t.get("watchlist", []))
        if watch:
            lines.append(f"- Watchlist: {watch}")
        lines.append("")
    lines.append("— Sector Thesis Scout")
    return {
        "subject": f"Tunisia investment themes — {len(theses)} live theses",
        "body_markdown": "\n".join(lines),
        "source": "fallback",
    }


# ══════════════════════════════════════════════════════════════════════════════
# PERSISTENCE
# ══════════════════════════════════════════════════════════════════════════════

def _upsert_theme_run(
    db: Session, summary: dict, theses: list[dict], diff: list[str],
    newsletter: dict, source: str,
) -> ThemeRun:
    """Write one run per week (period Monday); overwrite if it already exists."""
    period_start, period_end = _current_period()
    run = db.query(ThemeRun).filter(ThemeRun.period_start == period_start).first()

    # Never replace existing content with an empty run (Ollama down + empty DB):
    # keep the last good market-trends so the dashboard never goes blank.
    if not theses:
        prev = run or db.query(ThemeRun).order_by(ThemeRun.generated_at.desc()).first()
        if prev and json.loads(prev.theses_json or "[]"):
            return prev

    fields = dict(
        period_end=period_end,
        subject=newsletter["subject"],
        body_markdown=newsletter["body_markdown"],
        theses_json=json.dumps(theses, ensure_ascii=False),
        summary_json=json.dumps(summary, ensure_ascii=False),
        diff_json=json.dumps(diff, ensure_ascii=False),
        source=source,
    )
    if run:
        for k, v in fields.items():
            setattr(run, k, v)
        run.read = False  # fresh content → resurface as unread
    else:
        run = ThemeRun(period_start=period_start, **fields)
        db.add(run)
    db.commit()
    db.refresh(run)
    return run


# ══════════════════════════════════════════════════════════════════════════════
# PUBLIC ENTRY POINTS
# ══════════════════════════════════════════════════════════════════════════════

async def generate_theme_run(db: Session) -> ThemeRun:
    """Build, rank, diff, draft and persist this period's theme run.

    Used by BOTH the scheduled job and the on-demand `run-now` endpoint, so the two
    paths are identical. Never raises on LLM issues — degrades to a deterministic draft.
    """
    summary = build_db_summary(db)
    watch_map = _top_startups_by_sector(db)

    # Capture the previous run BEFORE upserting (it may be this week's earlier row).
    prev_run = db.query(ThemeRun).order_by(ThemeRun.generated_at.desc()).first()

    theses, theses_source = await _rank_theses(summary)
    _attach_watchlist(theses, watch_map)
    diff = _diff_vs_last(prev_run, summary, theses)
    newsletter = await _draft_newsletter(theses, diff)

    # The run is "fallback" if either reasoning step degraded.
    source = "ollama" if theses_source == "ollama" and newsletter["source"] == "ollama" else "fallback"
    return _upsert_theme_run(db, summary, theses, diff, newsletter, source)


async def run_weekly_scout(db: Session) -> ThemeRun | None:
    """Scheduled entry point: generate the run, then hand the newsletter to the
    (currently inactive) email seam for every investor."""
    from services.email_service import send_newsletter
    try:
        run = await generate_theme_run(db)
    except Exception as exc:
        db.rollback()
        print(f"[WARN] Sector Thesis Scout run failed: {exc}")
        return None

    recipients = [i.email for i in db.query(Investor).all() if i.email]
    send_newsletter(recipients, run.subject, run.body_markdown)
    print(f"[OK] Sector Thesis Scout wrote theme run #{run.id} (source={run.source})")
    return run
