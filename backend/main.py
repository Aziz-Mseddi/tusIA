import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv

# Load the project-root .env before any module reads os.getenv() at import time
# (e.g. services/ollama_service.py reads OLLAMA_BASE_URL/OLLAMA_MODEL on import).
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from database import engine, SessionLocal, run_light_migrations
from models import Base, MetricsBenchmark
from services.ollama_service import check_ollama_health
from services.scoring_engine import DEFAULT_BENCHMARKS
from services.watchdog_agent import run_weekly_watchdog
from services.thesis_scout_agent import run_weekly_scout
from seed_data import seed_if_empty
from routers import mode1, mode2, startups, chat, auth as auth_router, monitoring as monitoring_router
from routers import benchmarks as benchmarks_router
from routers import settings as settings_router
from routers import memory as memory_router

_BENCHMARK_DESCRIPTIONS = {
    "revenue_cagr_3y":            "3-year revenue compound annual growth rate (%)",
    "ebitda_margin":               "EBITDA as % of revenue",
    "total_addressable_market_M":  "Total addressable market size (USD millions)",
    "market_growth_rate":          "Annual market growth rate (%)",
    "competition_intensity":       "Competition level 0–10 (lower = less competition)",
    "regulatory_stability":        "Regulatory environment quality 0–10 (higher = more stable)",
    "debt_to_ebitda":              "Net debt divided by EBITDA (lower = healthier)",
    "current_ratio":               "Current assets / current liabilities (higher = better liquidity)",
    "esg_score":                   "Environmental, Social & Governance score 0–10",
}


def _seed_benchmarks() -> None:
    """Insert default African benchmarks into DB on first run (idempotent)."""
    db = SessionLocal()
    try:
        if db.query(MetricsBenchmark).count() > 0:
            return
        for name, bm in DEFAULT_BENCHMARKS.items():
            db.add(MetricsBenchmark(
                metric_name=name,
                african_avg=bm["avg"],
                african_best=bm["best"],
                is_negative=bm["is_negative"],
                description=_BENCHMARK_DESCRIPTIONS.get(name),
            ))
        db.commit()
        print(f"[OK] Seeded {len(DEFAULT_BENCHMARKS)} benchmark metrics")
    except Exception as exc:
        db.rollback()
        print(f"[WARN] Benchmark seeding failed: {exc}")
    finally:
        db.close()


async def _scheduled_watchdog() -> None:
    """Weekly job wrapper: open a dedicated session, run the agent, clean up."""
    db = SessionLocal()
    try:
        await run_weekly_watchdog(db)
    except Exception as exc:
        db.rollback()
        print(f"[WARN] Scheduled Portfolio Watchdog run failed: {exc}")
    finally:
        db.close()


async def _scheduled_scout() -> None:
    """Weekly job wrapper for the Sector Thesis Scout newsletter agent."""
    db = SessionLocal()
    try:
        await run_weekly_scout(db)
    except Exception as exc:
        db.rollback()
        print(f"[WARN] Scheduled Sector Thesis Scout run failed: {exc}")
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    run_light_migrations()
    _seed_benchmarks()
    seed_if_empty()

    healthy = await check_ollama_health()
    app.state.ollama_available = healthy
    if healthy:
        print("[OK] TunisIA Invest backend running | Ollama reachable")
    else:
        print("[OK] TunisIA Invest backend running | [WARN] Ollama not reachable")

    # Ensure at least one Sector Thesis Scout run exists so the dashboard
    # Market-Trends block always renders. Only seeds when none exists, so it
    # never overwrites a previously generated (richer) run on restart.
    try:
        from services.thesis_scout_agent import generate_theme_run
        from models import ThemeRun
        db = SessionLocal()
        try:
            if db.query(ThemeRun).first() is None:
                await generate_theme_run(db)
                print("[OK] Seeded initial Sector Thesis Scout run")
        finally:
            db.close()
    except Exception as exc:
        print(f"[WARN] Initial Sector Thesis Scout seed failed: {exc}")

    # Portfolio Watchdog — weekly background agent (Mondays 08:00, server-local time)
    scheduler = AsyncIOScheduler()
    scheduler.add_job(
        _scheduled_watchdog, "cron",
        day_of_week="mon", hour=8, minute=0,
        misfire_grace_time=3600, coalesce=True, id="portfolio_watchdog",
    )
    # Sector Thesis Scout — weekly market-trends newsletter (Mondays 08:30, 30 min
    # after the Watchdog to avoid overlapping Ollama load).
    scheduler.add_job(
        _scheduled_scout, "cron",
        day_of_week="mon", hour=8, minute=30,
        misfire_grace_time=3600, coalesce=True, id="sector_thesis_scout",
    )
    scheduler.start()
    app.state.scheduler = scheduler
    print("[OK] Portfolio Watchdog scheduled (weekly, Mon 08:00)")
    print("[OK] Sector Thesis Scout scheduled (weekly, Mon 08:30)")

    yield

    scheduler.shutdown(wait=False)


app = FastAPI(title="TunisIA Invest API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*", "Authorization", "Content-Type"],
)

app.include_router(auth_router.router)
app.include_router(monitoring_router.router)
app.include_router(mode1.router)
app.include_router(mode2.router)
app.include_router(startups.router)
app.include_router(chat.router)
app.include_router(benchmarks_router.router)
app.include_router(settings_router.router)
app.include_router(memory_router.router)


@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"error": "Internal server error", "detail": str(exc)},
    )


@app.get("/api/v1/health")
async def health():
    live = await check_ollama_health()
    app.state.ollama_available = live
    return {
        "status": "ok",
        "ollama_available": live,
    }
