from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import Startup
from services.scoring_engine import score_company, load_benchmarks_from_db

router = APIRouter(prefix="/api/v1/startups", tags=["startups"])


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


@router.get("/meta")
def get_meta(db: Session = Depends(get_db)):
    startups = db.query(Startup).all()
    sectors: dict = {}
    countries: set = set()
    regions: set = set()
    sub_sectors: set = set()
    for s in startups:
        sectors[s.sector] = sectors.get(s.sector, 0) + 1
        countries.add(s.country)
        if s.region:
            regions.add(s.region)
        if s.sub_sector:
            sub_sectors.add(s.sub_sector)
    return {
        "total": len(startups),
        "sectors": [{"name": k, "count": v} for k, v in sorted(sectors.items())],
        "countries": sorted(list(countries)),
        "regions": sorted(list(regions)),
        "sub_sectors": sorted(list(sub_sectors)),
    }


@router.get("/{startup_id}")
def get_startup(startup_id: int, db: Session = Depends(get_db)):
    s = db.query(Startup).filter(Startup.id == startup_id).first()
    if not s:
        raise HTTPException(404, detail={"error": "Not found", "detail": "Startup not found"})
    benchmarks = load_benchmarks_from_db(db)
    item = _startup_to_dict(s)
    item["score_result"] = _score_startup(s, benchmarks)
    return item
