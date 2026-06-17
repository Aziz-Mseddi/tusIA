import json
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, UploadFile, File
from sqlalchemy.orm import Session
from typing import List, Optional
from collections import Counter

from database import get_db, SessionLocal
from models import Startup, Investor, Mode2Assessment, Mode2Job
from schemas import (
    FindAnaloguesRequest,
    ViabilityVerdictRequest,
    ExplainAnalogueRequest,
    FounderQuestionsRequest,
    FindAnaloguesBatchRequest,
    ViabilityVerdictBatchRequest,
    Mode2AssessmentCreate,
    Mode2AssessmentSummary,
    Mode2AssessmentDetail,
)
from routers.auth import require_investor
from services.scoring_engine import score_company, load_benchmarks_from_db
from services.ollama_service import chat, extract_json
from services.doc_parser import extract_text_from_file, has_meaningful_text

# qwen3.6 has a 256k context and ollama_service requests num_ctx=16384, so
# there's room for far more than the old 4k char slice — which often cut
# pitch decks off before the page containing key facts.
EXTRACTION_TEXT_LIMIT = 16000

router = APIRouter(prefix="/api/v1/mode2", tags=["mode2"])


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


def _score_startup(s: Startup) -> dict:
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
    )


EXTRACT_PROFILE_SYSTEM_PROMPT = (
    "You are a business analyst extracting startup profiles from investor "
    "documents (pitch decks, business plans), often written in French.\n\n"
    "First, determine how many DISTINCT startups/companies are described as "
    "investment candidates in the provided text. Usually it's one, but a single "
    "document can describe several candidate companies, or multiple documents can "
    "each describe a different one.\n\n"
    "Return ONLY valid JSON, no prose, matching exactly this shape:\n"
    '{"startups": [ {"name": string|null, "sector": string|null, "sub_sector": string|null, '
    '"stage": string|null, "business_model": string|null, "tech_enabled": boolean|null, '
    '"employees_estimate": int|null, "revenue_estimate_usd": float|null, '
    '"description": string|null, "tags": string[]|null, '
    '"target_market": string|null, "key_product": string|null}, ... ]}\n\n'
    "ALWAYS return a JSON array under \"startups\", even when there is only ONE "
    "company (an array with a single element).\n\n"
    "Sector must be one of: Fintech, Agritech, Edtech, Healthtech, E-commerce, Logistics, "
    "Cleantech, SaaS, Food & Beverage, Manufacturing, Retail, Tourism Tech.\n"
    "Stage must be one of: creation (idea/pre-revenue), development (scaling), "
    "restructuring (turnaround).\n"
    "Business model must be one of: B2B, B2C, B2B2C, Marketplace.\n"
    "revenue_estimate_usd is an ABSOLUTE USD amount (convert TND/EUR and "
    "'$1M'/'500k' style figures to a plain number).\n"
    "Set any field to null if it cannot be determined from the text — never invent values.\n\n"
    "Example (single startup):\n"
    'Input excerpt: "GreenCart est une marketplace B2C de livraison de '
    'produits frais a Tunis. 18 employes, CA 2024: 320 000 TND."\n'
    'Output: {"startups": [{"name": "GreenCart", "sector": "E-commerce", "sub_sector": "Online Grocery", '
    '"stage": "development", "business_model": "B2C", "tech_enabled": true, '
    '"employees_estimate": 18, "revenue_estimate_usd": 106667.0, '
    '"description": "B2C marketplace delivering fresh products in Tunis.", '
    '"tags": ["delivery", "marketplace"], "target_market": "Tunis consumers", '
    '"key_product": "Fresh grocery delivery app"}]}\n\n'
    "Example (multiple startups in one document):\n"
    'Input excerpt: a memo comparing two investment candidates, "GreenCart" '
    '(B2C grocery delivery) and "PaySmart" (B2B fintech payments app).\n'
    'Output: {"startups": [{"name": "GreenCart", ...}, {"name": "PaySmart", ...}]}'
)


async def _run_extract_job(job_id: int, combined_text: str, files_processed: List[str]) -> None:
    """Background worker for /extract-profile — runs after the request has returned
    so a hard page refresh doesn't abort the Ollama call."""
    db = SessionLocal()
    try:
        job = db.query(Mode2Job).filter(Mode2Job.id == job_id).first()
        if not job:
            return

        if not has_meaningful_text(combined_text):
            job.status = "done"
            job.result_json = json.dumps({
                "extracted_profiles": [],
                "is_multiple": False,
                "raw_text_preview": combined_text[:500],
                "files_processed": files_processed,
                "error": (
                    "No readable text found in the uploaded file(s). If it's a "
                    "scanned/image PDF, it needs OCR before AI extraction can work."
                ),
            })
            db.commit()
            return

        # TODO: RAG — retrieve relevant chunks from vector store based on query
        # temperature=0 → deterministic extraction; think=False → no qwen3 reasoning leak.
        extracted = await extract_json(
            EXTRACT_PROFILE_SYSTEM_PROMPT, combined_text[:EXTRACTION_TEXT_LIMIT], temperature=0.0, think=False,
        )
        if isinstance(extracted, list):
            startups = extracted
        elif isinstance(extracted, dict):
            startups = extracted.get("startups")
            if not isinstance(startups, list):
                startups = [extracted]
        else:
            startups = []

        job.status = "done"
        job.result_json = json.dumps({
            "extracted_profiles": startups,
            "is_multiple": len(startups) > 1,
            "raw_text_preview": combined_text[:500],
            "files_processed": files_processed,
        })
        db.commit()
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        job = db.query(Mode2Job).filter(Mode2Job.id == job_id).first()
        if job:
            job.status = "error"
            job.error = str(exc)
            db.commit()
    finally:
        db.close()


@router.post("/extract-profile")
async def extract_profile(
    request: Request,
    background_tasks: BackgroundTasks,
    files: List[UploadFile] = File(...),
    investor: Investor = Depends(require_investor),
    db: Session = Depends(get_db),
):
    if not request.app.state.ollama_available:
        raise HTTPException(503, detail={
            "error": "AI unavailable",
            "detail": "Ollama is not running. Start it with: ollama serve",
        })

    combined_text = ""
    files_processed = []
    for f in files:
        raw = await f.read()
        text = extract_text_from_file(f.filename, raw)
        combined_text += text + "\n\n"
        files_processed.append(f.filename)

    job = Mode2Job(investor_id=investor.id, job_type="extract")
    db.add(job)
    db.commit()
    db.refresh(job)

    background_tasks.add_task(_run_extract_job, job.id, combined_text, files_processed)
    return {"job_id": job.id}


@router.get("/jobs/{job_id}")
def get_job(
    job_id: int,
    investor: Investor = Depends(require_investor),
    db: Session = Depends(get_db),
):
    job = (
        db.query(Mode2Job)
        .filter(Mode2Job.id == job_id, Mode2Job.investor_id == investor.id)
        .first()
    )
    if not job:
        raise HTTPException(404, detail={"error": "Not found", "detail": "Job not found"})
    return {
        "id": job.id,
        "job_type": job.job_type,
        "status": job.status,
        "result": json.loads(job.result_json) if job.result_json else None,
        "error": job.error,
    }


def _find_analogues_for_profile(profile: dict, db: Session) -> dict:
    sector = profile.get("sector")
    if not sector:
        raise HTTPException(400, detail={"error": "Bad request", "detail": "sector is required"})

    sub_sector     = profile.get("sub_sector")
    business_model = profile.get("business_model")
    stage          = profile.get("stage")
    tech_enabled   = profile.get("tech_enabled")

    def _query(extra_filters: dict) -> list:
        q = db.query(Startup).filter(Startup.sector == sector)
        if extra_filters.get("sub_sector"):
            q = q.filter(Startup.sub_sector == extra_filters["sub_sector"])
        if extra_filters.get("business_model"):
            q = q.filter(Startup.business_model == extra_filters["business_model"])
        if extra_filters.get("stage"):
            q = q.filter(Startup.stage == extra_filters["stage"])
        if extra_filters.get("tech_enabled") is not None:
            q = q.filter(Startup.tech_enabled == extra_filters["tech_enabled"])
        return q.all()

    match_relaxed = False
    warning = None

    # Strict match
    strict_params = {k: v for k, v in {
        "sub_sector": sub_sector, "business_model": business_model,
        "stage": stage, "tech_enabled": tech_enabled,
    }.items() if v is not None}
    results = _query(strict_params)

    # Relax 1: sector + business_model only
    if len(results) < 5:
        relax1 = {"business_model": business_model} if business_model else {}
        results = _query(relax1)
        match_relaxed = True

    # Relax 2: sector only
    if len(results) < 3:
        results = _query({})
        match_relaxed = True
        warning = (
            f"Only {len(results)} analogues found for this business type. "
            "The viability verdict will have LOW confidence. "
            "Consider adjusting the sector or business model in Step 1."
        )

    # Score all
    scored = []
    for s in results:
        item = _startup_to_dict(s)
        item["score_result"] = _score_startup(s)
        scored.append(item)

    # Group by country
    groups: dict = {}
    for item in scored:
        c = item["country"]
        groups.setdefault(c, []).append(item)

    success_statuses = {"active", "acquired", "ipo"}
    by_country = []
    for country, items in groups.items():
        items.sort(key=lambda x: x["score_result"]["final_score"], reverse=True)
        avg_score = round(sum(i["score_result"]["final_score"] for i in items) / len(items), 2)
        success_n = sum(1 for i in items if i["exit_status"] in success_statuses)
        by_country.append({
            "country": country,
            "count": len(items),
            "avg_score": avg_score,
            "success_rate_percent": round(success_n / len(items) * 100, 1),
            "startups": items,
        })

    by_country.sort(key=lambda x: x["avg_score"], reverse=True)

    total = len(scored)
    success_count = sum(1 for i in scored if i["exit_status"] in success_statuses)
    failure_count = sum(1 for i in scored if i["exit_status"] == "failed")

    return {
        "total_analogues": total,
        "countries_represented": len(by_country),
        "success_count": success_count,
        "failure_count": failure_count,
        "success_rate_percent": round(success_count / total * 100, 1) if total else 0,
        "failure_rate_percent": round(failure_count / total * 100, 1) if total else 0,
        "match_relaxed": match_relaxed,
        "warning": warning,
        "by_country": by_country,
    }


@router.post("/find-analogues")
def find_analogues(body: FindAnaloguesRequest, db: Session = Depends(get_db)):
    return _find_analogues_for_profile(body.profile, db)


@router.post("/find-analogues-batch")
def find_analogues_batch(body: FindAnaloguesBatchRequest, db: Session = Depends(get_db)):
    results = []
    for idx, profile in enumerate(body.profiles):
        analogues = _find_analogues_for_profile(profile, db)
        total_count = sum(c["count"] for c in analogues["by_country"])
        overall_avg_score = (
            round(sum(c["avg_score"] * c["count"] for c in analogues["by_country"]) / total_count, 2)
            if total_count else 0.0
        )
        results.append({
            "profile_name": profile.get("name") or f"Startup {idx + 1}",
            "analogues": analogues,
            "overall_avg_score": overall_avg_score,
            "success_rate_percent": analogues["success_rate_percent"],
        })

    best_choice_name = None
    best_choice_reason = ""
    if results:
        best = max(results, key=lambda r: (r["success_rate_percent"], r["overall_avg_score"]))
        best_choice_name = best["profile_name"]
        best_choice_reason = (
            f"Highest success rate ({best['success_rate_percent']:.0f}%) and average analogue "
            f"score ({best['overall_avg_score']:.0f}) among the {len(results)} candidates."
        )

    return {
        "results": results,
        "best_choice_name": best_choice_name,
        "best_choice_reason": best_choice_reason,
    }


async def _run_verdict_job(job_id: int, profile: dict, analogues_summary: dict) -> None:
    """Background worker for /viability-verdict."""
    db = SessionLocal()
    try:
        job = db.query(Mode2Job).filter(Mode2Job.id == job_id).first()
        if not job:
            return

        s = analogues_summary
        system_prompt = (
            "You are a private equity analyst specializing in emerging markets. "
            "A Tunisian investor is evaluating the following startup:\n"
            f"{json.dumps(profile, indent=2)}\n\n"
            f"In economically comparable markets, {s['total_analogues']} analogous businesses were found:\n"
            f"- Success rate: {s['success_rate_percent']}%\n"
            f"- Failure rate: {s['failure_rate_percent']}%\n"
            f"- Countries analyzed: {', '.join(s['countries'])}\n"
            f"- Most common failure reasons: {json.dumps(s['top_failure_reasons'])}\n"
            f"- Most common success signals: {json.dumps(s['top_success_signals'])}\n"
            f"- Average score by country: {json.dumps(s['avg_score_by_country'])}\n\n"
            "Based solely on these patterns from comparable markets, simulate the viability "
            "of this business type in Tunisia. Return ONLY valid JSON: "
            '{"recommendation": "INVEST"|"CAUTION"|"AVOID", '
            '"confidence": "LOW"|"MEDIUM"|"HIGH", '
            '"simulated_success_probability_percent": int, '
            '"favorable_signals": [string, string, string], '
            '"risk_factors": [string, string, string], '
            '"country_benchmark": string, "country_benchmark_reason": string, '
            '"explanation": string}'
        )

        # TODO: RAG — retrieve relevant chunks from vector store based on query
        verdict = await extract_json(
            system_prompt, "Generate the viability verdict based on the above data.",
            temperature=0.0, think=False,
        )

        job.status = "done"
        job.result_json = json.dumps(verdict)
        db.commit()
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        job = db.query(Mode2Job).filter(Mode2Job.id == job_id).first()
        if job:
            job.status = "error"
            job.error = str(exc)
            db.commit()
    finally:
        db.close()


@router.post("/viability-verdict")
async def viability_verdict(
    body: ViabilityVerdictRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    investor: Investor = Depends(require_investor),
    db: Session = Depends(get_db),
):
    if not request.app.state.ollama_available:
        raise HTTPException(503, detail={
            "error": "AI unavailable",
            "detail": "Ollama is not running. Start it with: ollama serve",
        })

    job = Mode2Job(investor_id=investor.id, job_type="verdict")
    db.add(job)
    db.commit()
    db.refresh(job)

    background_tasks.add_task(_run_verdict_job, job.id, body.profile, body.analogues_summary.model_dump())
    return {"job_id": job.id}


async def _run_verdict_batch_job(job_id: int, names: List[str], candidates_blocks: List[str]) -> None:
    """Background worker for /viability-verdict-batch."""
    db = SessionLocal()
    try:
        job = db.query(Mode2Job).filter(Mode2Job.id == job_id).first()
        if not job:
            return

        system_prompt = (
            "You are a private equity analyst specializing in emerging markets. "
            "A Tunisian investor is comparing the following investment candidates, "
            "each with patterns drawn from analogous businesses in comparable markets:\n\n"
            + "\n".join(candidates_blocks)
            + "\n\nFor EACH candidate, simulate its viability in Tunisia based solely on "
            "the comparable-market patterns above. Then pick the single best candidate to "
            "invest in overall.\n\n"
            "Return ONLY valid JSON matching exactly this shape:\n"
            '{"best_choice_name": string, "best_choice_reason": string, '
            '"items": [ {"name": string, '
            '"recommendation": "INVEST"|"CAUTION"|"AVOID", '
            '"confidence": "LOW"|"MEDIUM"|"HIGH", '
            '"simulated_success_probability_percent": int, '
            '"favorable_signals": [string, string, string], '
            '"risk_factors": [string, string, string], '
            '"country_benchmark": string, "country_benchmark_reason": string, '
            '"explanation": string}, ... ] }\n\n'
            f"\"items\" must contain exactly one entry per candidate, with \"name\" matching "
            f"one of: {json.dumps(names)}. \"best_choice_name\" must also be one of these names."
        )

        # TODO: RAG — retrieve relevant chunks from vector store based on query
        verdict = await extract_json(
            system_prompt, "Generate the comparative viability verdict based on the above data.",
            temperature=0.0, think=False,
        )

        # Override the AI's pick with a deterministic one: the candidate with the
        # highest simulated success probability is always the suggested best choice,
        # so the headline recommendation always matches the per-card percentages shown.
        items = verdict.get("items") or []
        if items:
            best_item = max(items, key=lambda it: it.get("simulated_success_probability_percent", 0) or 0)
            verdict["best_choice_name"] = best_item.get("name")
            verdict["best_choice_reason"] = (
                f"Highest simulated success rate ({best_item.get('simulated_success_probability_percent', 0)}%) "
                f"among the {len(items)} candidates."
            )

        job.status = "done"
        job.result_json = json.dumps(verdict)
        db.commit()
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        job = db.query(Mode2Job).filter(Mode2Job.id == job_id).first()
        if job:
            job.status = "error"
            job.error = str(exc)
            db.commit()
    finally:
        db.close()


@router.post("/viability-verdict-batch")
async def viability_verdict_batch(
    body: ViabilityVerdictBatchRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    investor: Investor = Depends(require_investor),
    db: Session = Depends(get_db),
):
    if not request.app.state.ollama_available:
        raise HTTPException(503, detail={
            "error": "AI unavailable",
            "detail": "Ollama is not running. Start it with: ollama serve",
        })

    candidates_blocks = []
    for item in body.items:
        s = item.analogues_summary
        candidates_blocks.append(
            f"Candidate \"{item.name}\":\n"
            f"Profile: {json.dumps(item.profile, indent=2)}\n"
            f"Comparable businesses in similar markets: {s.total_analogues}\n"
            f"- Success rate: {s.success_rate_percent}%\n"
            f"- Failure rate: {s.failure_rate_percent}%\n"
            f"- Countries analyzed: {', '.join(s.countries)}\n"
            f"- Most common failure reasons: {json.dumps(s.top_failure_reasons)}\n"
            f"- Most common success signals: {json.dumps(s.top_success_signals)}\n"
            f"- Average score by country: {json.dumps(s.avg_score_by_country)}\n"
        )
    names = [item.name for item in body.items]

    job = Mode2Job(investor_id=investor.id, job_type="multi_verdict")
    db.add(job)
    db.commit()
    db.refresh(job)

    background_tasks.add_task(_run_verdict_batch_job, job.id, names, candidates_blocks)
    return {"job_id": job.id}


@router.post("/explain-analogue")
async def explain_analogue(body: ExplainAnalogueRequest, request: Request, db: Session = Depends(get_db)):
    if not request.app.state.ollama_available:
        raise HTTPException(503, detail={
            "error": "AI unavailable",
            "detail": "Ollama is not running. Start it with: ollama serve",
        })

    s = db.query(Startup).filter(Startup.id == body.startup_id).first()
    if not s:
        raise HTTPException(404, detail={"error": "Not found", "detail": "Startup not found"})

    sc = _score_startup(s)
    analogue_context = (
        f"Company: {s.name} | Country: {s.country} | Sector: {s.sector} | Stage: {s.stage}\n"
        f"Business Model: {s.business_model} | Tech-Enabled: {s.tech_enabled}\n"
        f"Employees: {s.employees} | Revenue: ${s.annual_revenue_usd:,.0f}\n"
        f"Exit Status: {s.exit_status}"
        + (f" | Failure Reason: {s.failure_reason}" if s.failure_reason else "") + "\n"
        f"Description: {s.description}\n"
        f"Score: {sc['final_score']} | Grade: {sc['grade']} | Zone: {sc['decision_zone']}\n"
        f"Risk: {sc['risk_level']} | ROI estimate: {sc['estimated_roi']:.1%}"
    )

    system_prompt = (
        f"You are a private equity analyst. The investor is evaluating a Tunisian startup "
        f"and is asking about a comparable company from {s.country}. "
        "Answer concisely. If asked about failure, focus on root causes in the context "
        "of market conditions. Keep answer under 150 words."
    )
    user_message = (
        f"Tunisian startup context: {body.tunisian_profile_summary}\n\n"
        f"Comparable company: {analogue_context}\n\n"
        f"Question: {body.question}"
    )

    # TODO: RAG — retrieve relevant chunks from vector store based on query
    answer = await chat(system_prompt, user_message)
    return {"answer": answer, "startup_id": body.startup_id}


@router.post("/founder-questions")
async def founder_questions(body: FounderQuestionsRequest, request: Request, db: Session = Depends(get_db)):
    if not request.app.state.ollama_available:
        raise HTTPException(503, detail={
            "error": "AI unavailable",
            "detail": "Ollama is not running. Start it with: ollama serve",
        })

    benchmarks = load_benchmarks_from_db(db)
    benchmark_lines = [
        f"- {metric}: African avg {bm['avg']}, best-in-class {bm['best']} "
        f"({'lower is better' if bm['is_negative'] else 'higher is better'})"
        for metric, bm in benchmarks.items()
    ]

    s = body.analogues_summary
    system_prompt = (
        "You are a venture capital analyst preparing an investor for a founder meeting. "
        "You are given a startup profile extracted from a pitch deck, the financial/market "
        "metrics that the scoring model uses to evaluate Tunisian startups (with African-market "
        "benchmark reference values), and a summary of comparable companies (analogues) found "
        "in similar markets.\n\n"
        f"Startup profile:\n{json.dumps(body.profile, indent=2)}\n\n"
        "Scoring metrics & benchmarks (these drive the viability score, but the pitch above "
        "may not address them — that's a gap):\n" + "\n".join(benchmark_lines) + "\n\n"
        f"Comparable companies: {s.total_analogues} found across {s.countries_represented} "
        f"countries — success rate {s.success_rate_percent}%, failure rate {s.failure_rate_percent}%.\n"
        f"Most common failure reasons among comparables: {json.dumps(s.top_failure_reasons)}\n"
        f"Most common success signals among comparables: {json.dumps(s.top_success_signals)}\n\n"
        "Your task: identify the most important GAPS — metrics missing from the pitch that the "
        "scoring model needs, OR claims in the pitch that look optimistic/unverified compared to "
        "the benchmarks or to the comparable companies' failure patterns. For each gap, write ONE "
        "sharp question to ask the founder that would close that gap, grouped into a theme.\n\n"
        "Return ONLY valid JSON matching exactly this shape:\n"
        '{"questions": [{"theme": "market"|"unit_economics"|"moat"|"team"|"regulatory", '
        '"question": string, "gap": string, "why_it_matters": string}]}\n\n'
        "Produce 5 to 8 questions, covering at least 3 different themes. Each \"gap\" should name "
        "the specific missing metric or divergent claim. Each \"why_it_matters\" must be ONE "
        "sentence explaining the investment risk if left unanswered.\n\n"
        "Example question: {\"theme\": \"unit_economics\", \"question\": \"What is your current "
        "EBITDA margin and 3-year revenue CAGR?\", \"gap\": \"Pitch gives revenue but no margin or "
        "growth-rate figures, both required by the scoring model.\", \"why_it_matters\": \"Without "
        "these, the financial pillar (30% of the score) cannot be assessed and defaults to a "
        "missing-data penalty.\"}"
    )

    result = await extract_json(
        system_prompt, "Generate the founder question set based on the above context.",
        temperature=0.0, think=False,
    )
    return result


# ── Assessment history ("memory") ───────────────────────────────────────────

def _compute_headline(is_multiple: bool, verdict: Optional[dict]) -> Optional[str]:
    if not verdict:
        return None
    if is_multiple:
        best = verdict.get("best_choice_name")
        return f"Best choice: {best}" if best else None
    rec = verdict.get("recommendation")
    prob = verdict.get("simulated_success_probability_percent")
    if rec and prob is not None:
        return f"{rec} · {prob}% success probability"
    return rec


def _derive_title(body: Mode2AssessmentCreate) -> str:
    if body.title:
        return body.title
    if body.is_multiple:
        if isinstance(body.profile, list) and body.profile:
            names = [p.get("name") for p in body.profile if isinstance(p, dict) and p.get("name")]
            if names:
                shown = " vs ".join(names[:3])
                extra = len(names) - 3
                return shown + (f" + {extra} more" if extra > 0 else "")
        return "Untitled comparison"
    if isinstance(body.profile, dict) and body.profile.get("name"):
        return body.profile["name"]
    return "Untitled assessment"


@router.post("/assessments", response_model=Mode2AssessmentSummary)
def save_assessment(
    body: Mode2AssessmentCreate,
    investor: Investor = Depends(require_investor),
    db: Session = Depends(get_db),
):
    record = Mode2Assessment(
        investor_id=investor.id,
        title=_derive_title(body),
        is_multiple=body.is_multiple,
        profile_json=json.dumps(body.profile),
        analogues_json=json.dumps(body.analogues) if body.analogues is not None else None,
        verdict_json=json.dumps(body.verdict) if body.verdict is not None else None,
        source_filenames=json.dumps(body.source_filenames) if body.source_filenames is not None else None,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return Mode2AssessmentSummary(
        id=record.id,
        created_at=record.created_at,
        title=record.title,
        is_multiple=record.is_multiple,
        headline=_compute_headline(record.is_multiple, body.verdict),
    )


@router.get("/assessments", response_model=List[Mode2AssessmentSummary])
def list_assessments(
    investor: Investor = Depends(require_investor),
    db: Session = Depends(get_db),
):
    records = (
        db.query(Mode2Assessment)
        .filter(Mode2Assessment.investor_id == investor.id)
        .order_by(Mode2Assessment.created_at.desc())
        .all()
    )
    return [
        Mode2AssessmentSummary(
            id=r.id,
            created_at=r.created_at,
            title=r.title,
            is_multiple=r.is_multiple,
            headline=_compute_headline(r.is_multiple, json.loads(r.verdict_json) if r.verdict_json else None),
        )
        for r in records
    ]


@router.get("/assessments/{assessment_id}", response_model=Mode2AssessmentDetail)
def get_assessment(
    assessment_id: int,
    investor: Investor = Depends(require_investor),
    db: Session = Depends(get_db),
):
    record = (
        db.query(Mode2Assessment)
        .filter(Mode2Assessment.id == assessment_id, Mode2Assessment.investor_id == investor.id)
        .first()
    )
    if not record:
        raise HTTPException(404, detail={"error": "Not found", "detail": "Assessment not found"})
    return Mode2AssessmentDetail(
        id=record.id,
        created_at=record.created_at,
        title=record.title,
        is_multiple=record.is_multiple,
        profile=json.loads(record.profile_json),
        analogues=json.loads(record.analogues_json) if record.analogues_json else None,
        verdict=json.loads(record.verdict_json) if record.verdict_json else None,
        source_filenames=json.loads(record.source_filenames) if record.source_filenames else None,
    )


@router.delete("/assessments/{assessment_id}")
def delete_assessment(
    assessment_id: int,
    investor: Investor = Depends(require_investor),
    db: Session = Depends(get_db),
):
    record = (
        db.query(Mode2Assessment)
        .filter(Mode2Assessment.id == assessment_id, Mode2Assessment.investor_id == investor.id)
        .first()
    )
    if not record:
        raise HTTPException(404, detail={"error": "Not found", "detail": "Assessment not found"})
    db.delete(record)
    db.commit()
    return {"deleted": True}
