from sqlalchemy.orm import Query
from models import Startup


def apply_filters(query: Query, filters: dict) -> Query:
    # Categorical
    if filters.get("sectors"):
        query = query.filter(Startup.sector.in_(filters["sectors"]))
    if filters.get("countries"):
        query = query.filter(Startup.country.in_(filters["countries"]))
    if filters.get("regions"):
        query = query.filter(Startup.region.in_(filters["regions"]))
    if filters.get("stages"):
        query = query.filter(Startup.stage.in_(filters["stages"]))
    if filters.get("business_models"):
        query = query.filter(Startup.business_model.in_(filters["business_models"]))
    if filters.get("exit_statuses"):
        query = query.filter(Startup.exit_status.in_(filters["exit_statuses"]))
    if filters.get("sub_sectors"):
        query = query.filter(Startup.sub_sector.in_(filters["sub_sectors"]))
    if filters.get("tech_enabled") is not None:
        query = query.filter(Startup.tech_enabled == filters["tech_enabled"])

    # Size
    if filters.get("min_employees") is not None:
        query = query.filter(Startup.employees >= filters["min_employees"])
    if filters.get("max_employees") is not None:
        query = query.filter(Startup.employees <= filters["max_employees"])
    if filters.get("min_founded_year") is not None:
        query = query.filter(Startup.founded_year >= filters["min_founded_year"])
    if filters.get("max_founded_year") is not None:
        query = query.filter(Startup.founded_year <= filters["max_founded_year"])
    if filters.get("min_age_years") is not None:
        query = query.filter(Startup.age_years >= filters["min_age_years"])
    if filters.get("max_age_years") is not None:
        query = query.filter(Startup.age_years <= filters["max_age_years"])

    # Financial
    if filters.get("min_revenue_usd") is not None:
        query = query.filter(Startup.annual_revenue_usd >= filters["min_revenue_usd"])
    if filters.get("max_revenue_usd") is not None:
        query = query.filter(Startup.annual_revenue_usd <= filters["max_revenue_usd"])
    if filters.get("min_revenue_cagr") is not None:
        query = query.filter(Startup.revenue_cagr_3y >= filters["min_revenue_cagr"])
    if filters.get("max_revenue_cagr") is not None:
        query = query.filter(Startup.revenue_cagr_3y <= filters["max_revenue_cagr"])
    if filters.get("min_ebitda_margin") is not None:
        query = query.filter(Startup.ebitda_margin >= filters["min_ebitda_margin"])
    if filters.get("max_ebitda_margin") is not None:
        query = query.filter(Startup.ebitda_margin <= filters["max_ebitda_margin"])

    # Market
    if filters.get("min_market_size_M") is not None:
        query = query.filter(Startup.total_addressable_market_M >= filters["min_market_size_M"])
    if filters.get("max_market_size_M") is not None:
        query = query.filter(Startup.total_addressable_market_M <= filters["max_market_size_M"])
    if filters.get("min_market_growth_rate") is not None:
        query = query.filter(Startup.market_growth_rate >= filters["min_market_growth_rate"])
    if filters.get("max_market_growth_rate") is not None:
        query = query.filter(Startup.market_growth_rate <= filters["max_market_growth_rate"])
    if filters.get("min_competition_intensity") is not None:
        query = query.filter(Startup.competition_intensity >= filters["min_competition_intensity"])
    if filters.get("max_competition_intensity") is not None:
        query = query.filter(Startup.competition_intensity <= filters["max_competition_intensity"])

    # Risk & Quality
    if filters.get("min_regulatory_stability") is not None:
        query = query.filter(Startup.regulatory_stability >= filters["min_regulatory_stability"])
    if filters.get("max_regulatory_stability") is not None:
        query = query.filter(Startup.regulatory_stability <= filters["max_regulatory_stability"])
    if filters.get("min_esg_score") is not None:
        query = query.filter(Startup.esg_score >= filters["min_esg_score"])
    if filters.get("max_esg_score") is not None:
        query = query.filter(Startup.esg_score <= filters["max_esg_score"])

    return query
