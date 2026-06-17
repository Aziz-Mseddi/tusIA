import json
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from database import get_db
from models import Startup
from schemas import (
    FilterRequest, PromptFilterRequest, ExplainRequest,
    SuggestionExplainRequest, SuggestionAskRequest,
)
from services.scoring_engine import score_company, load_benchmarks_from_db
from services.filter_parser import apply_filters
from services.ollama_service import chat, extract_json
from services.prompt_filter_service import (
    build_vocabulary,
    build_system_prompt,
    normalize_filters,
)

router = APIRouter(prefix="/api/v1/mode1", tags=["mode1"])


def _startup_to_dict(s: Startup) -> dict:
    return {
        "id": s.id, "name": s.name, "country": s.country, "region": s.region,
        "sector": s.sector, "sub_sector": s.sub_sector, "stage": s.stage,
        "founded_year": s.founded_year, "age_years": s.age_years,
        "employees": s.employees, "annual_revenue_usd": s.annual_revenue_usd,
        "revenue_cagr_3y": s.revenue_cagr_3y, "ebitda_margin": s.ebitda_margin,
        "total_addressable_market_M": s.total_addressable_market_M,
        "market_growth_rate": s.market_growth_rate,
        "competition_intensity": s.competition_intensity,
        "regulatory_stability": s.regulatory_stability,
        "debt_to_ebitda": s.debt_to_ebitda, "current_ratio": s.current_ratio,
        "local_infrastructure": s.local_infrastructure, "esg_score": s.esg_score,
        "business_model": s.business_model, "tech_enabled": s.tech_enabled,
        "exit_status": s.exit_status, "failure_reason": s.failure_reason,
        "description": s.description, "tags": s.tags,
    }


def _score_startup(s: Startup, benchmarks: dict | None = None) -> dict:
    return score_company(
        stage=s.stage,
        age_years=s.age_years,
        revenue_cagr_3y=s.revenue_cagr_3y,
        ebitda_margin=s.ebitda_margin,
        total_addressable_market_M=s.total_addressable_market_M,
        market_growth_rate=s.market_growth_rate,
        competition_intensity=s.competition_intensity,
        regulatory_stability=s.regulatory_stability,
        debt_to_ebitda=s.debt_to_ebitda,
        current_ratio=s.current_ratio,
        local_infrastructure=s.local_infrastructure,
        esg_score=s.esg_score,
        benchmarks=benchmarks,
    )


def build_db_summary(db: Session) -> dict:
    """
    Aggregate the whole startup/comparables DB into a compact, LLM-friendly summary
    of the current "market trends": how many startups per sector, the average
    investment score per sector (momentum signal), the top sectors, and the failure
    landscape (overall top reasons + a per-sector failure tally).

    Shared by the on-demand `/suggestions` endpoint and the weekly Sector Thesis
    Scout agent, so both reason over identical inputs.
    """
    from collections import Counter

    startups = db.query(Startup).all()
    benchmarks = load_benchmarks_from_db(db)

    sector_counts: dict = {}
    sector_scores: dict = {}
    failure_reasons: list = []
    failure_counts_by_sector: dict = {}
    for s in startups:
        sector_counts[s.sector] = sector_counts.get(s.sector, 0) + 1
        sc = _score_startup(s, benchmarks)
        sector_scores.setdefault(s.sector, []).append(sc["final_score"])
        if s.failure_reason:
            failure_reasons.append(s.failure_reason)
            failure_counts_by_sector[s.sector] = failure_counts_by_sector.get(s.sector, 0) + 1

    avg_by_sector = {sec: round(sum(v) / len(v), 1) for sec, v in sector_scores.items()}
    top3_sectors = sorted(avg_by_sector, key=lambda k: avg_by_sector[k], reverse=True)[:3]
    top_failures = [r for r, _ in Counter(failure_reasons).most_common(5)]

    return {
        "sector_counts": sector_counts,
        "avg_score_by_sector": avg_by_sector,
        "top3_sectors_by_score": top3_sectors,
        "top_failure_reasons": top_failures,
        "failure_counts_by_sector": failure_counts_by_sector,
    }


@router.post("/filter")
def filter_startups(body: FilterRequest, db: Session = Depends(get_db)):
    query = db.query(Startup)
    query = apply_filters(query, body.model_dump(exclude_none=True))
    startups = query.all()
    benchmarks = load_benchmarks_from_db(db)

    results = []
    for s in startups:
        item = _startup_to_dict(s)
        item["score_result"] = _score_startup(s, benchmarks)
        results.append(item)

    results.sort(key=lambda x: x["score_result"]["final_score"], reverse=True)
    return {"total": len(results), "results": results}


@router.post("/prompt-filter")
async def prompt_filter(body: PromptFilterRequest, request: Request, db: Session = Depends(get_db)):
    if not request.app.state.ollama_available:
        raise HTTPException(503, detail={
            "error": "AI unavailable",
            "detail": "Ollama is not running. Start it with: ollama serve",
        })

    # Build the canonical vocabulary from the live DB so the model is told the
    # exact categorical values it may emit, then extract + normalize the prompt
    # into the SAME filter shape the manual panel uses.
    vocab = build_vocabulary(db)
    system_prompt = build_system_prompt(vocab)

    try:
        # temperature=0 → same prompt yields the same filters every time;
        # think=False → skip qwen3 reasoning tokens (faster, cleaner JSON).
        raw_extracted = await extract_json(
            system_prompt, body.prompt, temperature=0.0, think=False,
        )
    except ValueError as exc:
        raise HTTPException(502, detail={
            "error": "AI parse error",
            "detail": f"Could not interpret the query. {exc}",
        })

    filters = normalize_filters(raw_extracted, vocab)

    query = db.query(Startup)
    query = apply_filters(query, filters)
    startups = query.all()
    benchmarks = load_benchmarks_from_db(db)

    results = []
    for s in startups:
        item = _startup_to_dict(s)
        item["score_result"] = _score_startup(s, benchmarks)
        results.append(item)

    results.sort(key=lambda x: x["score_result"]["final_score"], reverse=True)
    return {"interpreted_filters": filters, "total": len(results), "results": results}


@router.get("/suggestions")
async def get_suggestions(request: Request, db: Session = Depends(get_db)):
    if not request.app.state.ollama_available:
        raise HTTPException(503, detail={
            "error": "AI unavailable",
            "detail": "Ollama is not running. Start it with: ollama serve",
        })

    db_summary = build_db_summary(db)

    system_prompt = (
        "You are a private equity analyst specializing in emerging markets similar to Tunisia "
        "(MENA, Sub-Saharan Africa, South/Southeast Asia). "
        "The data below includes 'top3_sectors_by_score' and 'avg_score_by_sector' — these reflect "
        "which sectors are CURRENTLY TRENDING (highest-performing) in the database. "
        "Each suggestion's theme and supporting_sectors MUST be grounded in these trending sectors "
        "(favor sectors from top3_sectors_by_score and those with the highest avg_score_by_sector), "
        "while avoiding sectors with high failure_counts_by_sector unless framed as a turnaround/contrarian play. "
        "Based on this startup performance data, generate investment theme suggestions relevant to Tunisia. "
        "Return ONLY valid JSON array: "
        '[{"theme": string, "rationale": string, "supporting_sectors": string[], '
        '"risk_level": "Low"|"Medium"|"High", "example_countries": string[]}]. '
        "Generate exactly 5 suggestions."
    )

    # TODO: RAG — retrieve relevant chunks from vector store based on query
    suggestions = await extract_json(system_prompt, json.dumps(db_summary), temperature=0.0, think=False)
    if not isinstance(suggestions, list):
        suggestions = suggestions.get("suggestions", [])
    return {"suggestions": suggestions}


@router.post("/suggestions/explain")
async def explain_suggestion(body: SuggestionExplainRequest, request: Request):
    """Plain-English bullet-point breakdown of an investment suggestion, for non-experts."""
    if not request.app.state.ollama_available:
        raise HTTPException(503, detail={
            "error": "AI unavailable",
            "detail": "Ollama is not running. Start it with: ollama serve",
        })

    system_prompt = (
        "You explain investment ideas to someone with no finance or technology background. "
        "Rewrite the idea below as 3-5 short bullet points using plain, everyday English. "
        "Avoid jargon, acronyms, and technical or financial terms — explain things the way you "
        "would to a friend. Keep each bullet to one short sentence. "
        'Return ONLY a valid JSON object: {"bullets": [string, string, ...]}'
    )
    user_message = json.dumps({
        "theme": body.theme,
        "rationale": body.rationale,
        "supporting_sectors": body.supporting_sectors,
        "risk_level": body.risk_level,
    })

    result = await extract_json(system_prompt, user_message, temperature=0.0, think=False)
    bullets = result.get("bullets", []) if isinstance(result, dict) else result
    if not isinstance(bullets, list):
        bullets = [str(bullets)]
    return {"bullets": [str(b) for b in bullets]}


@router.post("/suggestions/ask")
async def ask_about_suggestions(body: SuggestionAskRequest, request: Request):
    """Inline Q&A assistant for the trending-suggestions panel."""
    if not request.app.state.ollama_available:
        raise HTTPException(503, detail={
            "error": "AI unavailable",
            "detail": "Ollama is not running. Start it with: ollama serve",
        })

    system_prompt = (
        "You are TunisIA, an AI investment assistant. The user is looking at a panel of AI-generated "
        "investment theme suggestions for emerging markets comparable to Tunisia (MENA, Sub-Saharan "
        "Africa, South/Southeast Asia). Answer their question about these suggestions clearly, in plain "
        "English, with no jargon. Keep the answer under 120 words."
    )
    user_message = (
        f"Suggestions shown to the user:\n{json.dumps(body.suggestions, indent=2)}\n\n"
        f"User question: {body.question}"
    )
    answer = await chat(system_prompt, user_message)
    return {"answer": answer}


# ── Sector Thesis Scout — weekly market-trends newsletter ─────────────────────

def _theme_run_to_dict(run) -> dict:
    """Serialise a ThemeRun row for the API (JSON-string columns → objects)."""
    return {
        "id": run.id,
        "period_start": run.period_start,
        "period_end": run.period_end,
        "generated_at": run.generated_at.isoformat() if run.generated_at else None,
        "subject": run.subject,
        "body_markdown": run.body_markdown,
        "theses": json.loads(run.theses_json or "[]"),
        "diff": json.loads(run.diff_json or "[]"),
        "source": run.source,
        "read": run.read,
    }


@router.get("/themes/latest")
def get_latest_theme_run(db: Session = Depends(get_db)):
    """Most recent Sector Thesis Scout run, or {run: null} if none generated yet."""
    from models import ThemeRun
    run = db.query(ThemeRun).order_by(ThemeRun.generated_at.desc()).first()
    return {"run": _theme_run_to_dict(run) if run else None}


@router.post("/themes/run-now")
async def run_theme_scout_now(db: Session = Depends(get_db)):
    """
    On-demand trigger for the Sector Thesis Scout — the same entry point the weekly
    scheduler calls, so a manual run and a scheduled run are identical. Completes via
    a deterministic fallback when Ollama is unavailable (never raises 503).
    """
    # Lazy import to avoid any import cycle at module load (matches monitoring.py).
    from services.thesis_scout_agent import generate_theme_run
    run = await generate_theme_run(db)
    return {"run": _theme_run_to_dict(run)}


@router.post("/explain")
async def explain_startup(body: ExplainRequest, request: Request, db: Session = Depends(get_db)):
    if not request.app.state.ollama_available:
        raise HTTPException(503, detail={
            "error": "AI unavailable",
            "detail": "Ollama is not running. Start it with: ollama serve",
        })

    s = db.query(Startup).filter(Startup.id == body.startup_id).first()
    if not s:
        raise HTTPException(404, detail={"error": "Not found", "detail": "Startup not found"})

    sc = _score_startup(s)
    context = (
        f"Company: {s.name} | Country: {s.country} | Sector: {s.sector} | Stage: {s.stage}\n"
        f"Employees: {s.employees} | Revenue: ${s.annual_revenue_usd:,.0f}\n"
        f"Exit Status: {s.exit_status}"
        + (f" | Failure Reason: {s.failure_reason}" if s.failure_reason else "") + "\n"
        f"Description: {s.description}\n\n"
        f"Score Results:\n"
        f"  Final Score: {sc['final_score']} | Grade: {sc['grade']} | Zone: {sc['decision_zone']}\n"
        f"  Risk: {sc['risk_level']} ({sc['risk_total']}) | ROI: {sc['estimated_roi']:.1%}\n"
        f"  Pillars: Execution={sc['pillars']['execution']}, Market={sc['pillars']['market']}, "
        f"Financial={sc['pillars']['financial']}, External={sc['pillars']['external']}\n"
        f"  Env Factor: {sc['env_factor']}"
    )

    system_prompt = (
        "You are a private equity analyst. Answer the investor's question concisely and precisely "
        "based only on the company data provided. If the question is about a low score, explain "
        "which pillars dragged it down and what specific metrics caused this. "
        "If about failure, analyze the failure_reason in context of market conditions."
    )
    user_message = f"Company context:\n{context}\n\nQuestion: {body.question}"

    # TODO: RAG — retrieve relevant chunks from vector store based on query
    answer = await chat(system_prompt, user_message)
    return {"answer": answer, "startup_id": body.startup_id}
