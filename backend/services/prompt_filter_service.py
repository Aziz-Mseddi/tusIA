"""
Natural-language → structured filter extraction for Mode I (Startup Explorer).

The manual FilterPanel and the AI ("prompt") search must produce identical
filter *semantics*. The AI path used to extract only ~8 of the ~30 filterable
fields, dropped every qualitative/numeric criterion ("high growth", "low risk",
"profitable", "$1M revenue"), and routed regions ("MENA", "East Africa") into
the country field — so AI search returned wildly different (often empty or
unfiltered) results compared to the manual panel.

This module fixes that end-to-end:

  1. build_vocabulary(db)   — reads the live DB so the model is always told the
     EXACT categorical values it may emit (sectors, countries, regions,
     sub-sectors), alongside the fixed enums (stage / business model / exit).

  2. build_system_prompt()  — a precise instruction set: every filterable field,
     its unit, a legend translating fuzzy investor language into the numeric
     thresholds the scoring data actually uses, plus few-shot examples.

  3. normalize_filters()    — maps whatever the model returns back onto canonical
     DB values (exact → case-insensitive → synonym → fuzzy) and correct numeric
     units, dropping anything it cannot map. This is the safety net that makes
     AI filters behave exactly like manual ones even when the model is sloppy.
"""
from __future__ import annotations

from difflib import get_close_matches
from typing import Any

from sqlalchemy.orm import Session

from models import Startup

# ── Fixed enums (authoritative; not derived from free text) ──────────────────
STAGES = ["creation", "development", "restructuring"]
BUSINESS_MODELS = ["B2B", "B2C", "B2B2C", "Marketplace"]
EXIT_STATUSES = ["active", "failed", "acquired", "ipo"]

# ── Numeric field groups (drive unit coercion / clamping) ────────────────────
PERCENT_FIELDS = {
    "min_revenue_cagr", "max_revenue_cagr",
    "min_ebitda_margin", "max_ebitda_margin",
    "min_market_growth_rate", "max_market_growth_rate",
}
SCALE_0_10_FIELDS = {
    "min_competition_intensity", "max_competition_intensity",
    "min_regulatory_stability", "max_regulatory_stability",
    "min_esg_score", "max_esg_score",
}
INT_FIELDS = {"min_employees", "max_employees", "min_founded_year", "max_founded_year"}
FLOAT_FIELDS = PERCENT_FIELDS | SCALE_0_10_FIELDS | {
    "min_age_years", "max_age_years",
    "min_revenue_usd", "max_revenue_usd",
    "min_market_size_M", "max_market_size_M",
}
NUMERIC_FIELDS = INT_FIELDS | FLOAT_FIELDS

# ── Synonym tables (lowercased token → canonical value) ──────────────────────
SECTOR_SYNONYMS = {
    "fintech": "Fintech", "finance": "Fintech", "financial": "Fintech",
    "financial services": "Fintech", "payments": "Fintech", "payment": "Fintech",
    "banking": "Fintech", "neobank": "Fintech", "insurtech": "Fintech", "lending": "Fintech",
    "agritech": "Agritech", "agtech": "Agritech", "agri": "Agritech", "agro": "Agritech",
    "agriculture": "Agritech", "farming": "Agritech", "agribusiness": "Agritech",
    "edtech": "Edtech", "education": "Edtech", "e-learning": "Edtech",
    "elearning": "Edtech", "learning": "Edtech", "education tech": "Edtech",
    "healthtech": "Healthtech", "health": "Healthtech", "healthcare": "Healthtech",
    "medical": "Healthtech", "medtech": "Healthtech", "biotech": "Healthtech", "health tech": "Healthtech",
    "e-commerce": "E-commerce", "ecommerce": "E-commerce", "e commerce": "E-commerce",
    "online retail": "E-commerce", "online shopping": "E-commerce",
    "logistics": "Logistics", "delivery": "Logistics", "supply chain": "Logistics",
    "shipping": "Logistics", "freight": "Logistics", "transport": "Logistics", "transportation": "Logistics",
    "cleantech": "Cleantech", "clean energy": "Cleantech", "renewable": "Cleantech",
    "renewables": "Cleantech", "solar": "Cleantech", "green energy": "Cleantech",
    "energy": "Cleantech", "climate": "Cleantech", "climate tech": "Cleantech",
    "saas": "SaaS", "software": "SaaS", "b2b software": "SaaS", "cloud software": "SaaS", "cloud": "SaaS",
    "food & beverage": "Food & Beverage", "food and beverage": "Food & Beverage",
    "food": "Food & Beverage", "beverage": "Food & Beverage", "f&b": "Food & Beverage",
    "foodtech": "Food & Beverage", "food tech": "Food & Beverage", "restaurant": "Food & Beverage",
    "manufacturing": "Manufacturing", "industrial": "Manufacturing", "factory": "Manufacturing",
    "retail": "Retail", "retailer": "Retail", "stores": "Retail",
    "tourism tech": "Tourism Tech", "tourism": "Tourism Tech", "travel": "Tourism Tech",
    "traveltech": "Tourism Tech", "travel tech": "Tourism Tech", "hospitality": "Tourism Tech",
}

STAGE_SYNONYMS = {
    "creation": "creation", "idea": "creation", "ideation": "creation",
    "seed": "creation", "pre-seed": "creation", "preseed": "creation",
    "early": "creation", "early stage": "creation", "early-stage": "creation",
    "startup": "creation", "nascent": "creation", "founding": "creation",
    "development": "development", "growth": "development", "growth stage": "development",
    "scaling": "development", "scale-up": "development", "scaleup": "development",
    "expansion": "development", "series a": "development", "series b": "development", "growing": "development",
    "restructuring": "restructuring", "turnaround": "restructuring", "turn-around": "restructuring",
    "distressed": "restructuring", "pivot": "restructuring", "recovery": "restructuring",
    "struggling": "restructuring",
}

BUSINESS_MODEL_SYNONYMS = {
    "b2b": "B2B", "business to business": "B2B", "business-to-business": "B2B",
    "b2c": "B2C", "business to consumer": "B2C", "business-to-consumer": "B2C", "consumer": "B2C",
    "b2b2c": "B2B2C",
    "marketplace": "Marketplace", "marketplaces": "Marketplace", "platform": "Marketplace",
}

EXIT_SYNONYMS = {
    "active": "active", "operating": "active", "operational": "active",
    "running": "active", "live": "active", "ongoing": "active", "still active": "active",
    "failed": "failed", "failure": "failed", "shut down": "failed", "shutdown": "failed",
    "closed": "failed", "bankrupt": "failed", "defunct": "failed", "dead": "failed",
    "collapsed": "failed", "ceased": "failed", "out of business": "failed",
    "acquired": "acquired", "bought": "acquired", "acquisition": "acquired",
    "m&a": "acquired", "takeover": "acquired",
    "ipo": "ipo", "public": "ipo", "listed": "ipo", "went public": "ipo",
    "ipoed": "ipo", "public listing": "ipo", "floated": "ipo",
}
# Terms that expand to several exit statuses at once.
EXIT_MULTI = {
    "exited": ["acquired", "ipo"], "exit": ["acquired", "ipo"], "exits": ["acquired", "ipo"],
    "successful exit": ["acquired", "ipo"], "successful": ["acquired", "ipo"],
}

REGION_SYNONYMS = {
    "mena": "MENA", "middle east": "MENA", "middle east and north africa": "MENA",
    "north africa": "North Africa", "northern africa": "North Africa", "maghreb": "North Africa",
    "east africa": "East Africa", "eastern africa": "East Africa",
    "west africa": "West Africa", "western africa": "West Africa",
    "central africa": "Central Africa",
    "south asia": "South Asia", "southern asia": "South Asia",
    "southeast asia": "Southeast Asia", "south east asia": "Southeast Asia",
    "south-east asia": "Southeast Asia", "se asia": "Southeast Asia",
}

COUNTRY_SYNONYMS = {
    "ivory coast": "Ivory Coast", "cote d'ivoire": "Ivory Coast",
    "côte d'ivoire": "Ivory Coast", "cote divoire": "Ivory Coast",
}

_FUZZY_CUTOFF = 0.84


# ── Vocabulary ───────────────────────────────────────────────────────────────
def build_vocabulary(db: Session) -> dict[str, list[str]]:
    """Pull the canonical categorical values straight from the database."""
    rows = db.query(
        Startup.sector, Startup.country, Startup.region, Startup.sub_sector
    ).all()
    sectors: set[str] = set()
    countries: set[str] = set()
    regions: set[str] = set()
    sub_sectors: set[str] = set()
    for sec, cty, reg, sub in rows:
        if sec:
            sectors.add(sec)
        if cty:
            countries.add(cty)
        if reg:
            regions.add(reg)
        if sub:
            sub_sectors.add(sub)
    return {
        "sectors": sorted(sectors),
        "countries": sorted(countries),
        "regions": sorted(regions),
        "sub_sectors": sorted(sub_sectors),
    }


# ── Categorical normalization ────────────────────────────────────────────────
def _canon_match(
    value: Any,
    canon: list[str],
    synonyms: dict[str, str],
    multi: dict[str, list[str]] | None = None,
) -> list[str]:
    """Resolve one raw token to zero or more canonical values."""
    if value is None:
        return []
    raw = str(value).strip()
    if not raw:
        return []
    low = raw.lower()
    canon_by_low = {c.lower(): c for c in canon}

    # 1. multi-term expansion (e.g. "exited" → acquired + ipo)
    if multi and low in multi:
        return [c for c in multi[low] if c in canon]
    # 2. exact, case-insensitive
    if low in canon_by_low:
        return [canon_by_low[low]]
    # 3. direct synonym
    if low in synonyms and synonyms[low] in canon:
        return [synonyms[low]]
    # 4. fuzzy against both canonical values and synonym keys
    pool = list(canon_by_low.keys()) + list(synonyms.keys())
    match = get_close_matches(low, pool, n=1, cutoff=_FUZZY_CUTOFF)
    if match:
        m = match[0]
        if m in canon_by_low:
            return [canon_by_low[m]]
        if m in synonyms and synonyms[m] in canon:
            return [synonyms[m]]
    return []


def _normalize_list(
    values: Any,
    canon: list[str],
    synonyms: dict[str, str],
    multi: dict[str, list[str]] | None = None,
) -> list[str] | None:
    """Normalize a list (or scalar) of raw tokens to canonical values."""
    if values is None:
        return None
    if isinstance(values, (str, int, float, bool)):
        values = [values]
    if not isinstance(values, (list, tuple, set)):
        return None
    out: list[str] = []
    for v in values:
        for c in _canon_match(v, canon, synonyms, multi):
            if c not in out:
                out.append(c)
    return out or None


def _coerce_number(key: str, value: Any) -> float | int | None:
    """Coerce a raw value into the field's expected unit."""
    if isinstance(value, bool):
        return None
    try:
        num = float(value)
    except (TypeError, ValueError):
        return None

    # Percent fields are stored as whole percentages (30.0 == 30%).
    # A model that emits a fraction (0.30) for "30%" is silently corrected.
    if key in PERCENT_FIELDS and -1.0 < num < 1.0 and num != 0.0:
        num *= 100.0
    # 0–10 quality scales: clamp out-of-range guesses.
    if key in SCALE_0_10_FIELDS:
        num = max(0.0, min(10.0, num))
    if key in INT_FIELDS:
        return int(round(num))
    return num


def _coerce_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        low = value.strip().lower()
        if low in {"true", "yes", "1", "y"}:
            return True
        if low in {"false", "no", "0", "n"}:
            return False
    return None


def normalize_filters(extracted: Any, vocab: dict[str, list[str]]) -> dict[str, Any]:
    """
    Map a raw LLM extraction onto a clean, canonical filter dict that
    apply_filters() can consume — identical in shape to the manual panel.
    """
    if not isinstance(extracted, dict):
        return {}

    out: dict[str, Any] = {}

    list_specs = [
        ("sectors", vocab["sectors"], SECTOR_SYNONYMS, None),
        ("countries", vocab["countries"], COUNTRY_SYNONYMS, None),
        ("regions", vocab["regions"], REGION_SYNONYMS, None),
        ("sub_sectors", vocab["sub_sectors"], {}, None),
        ("stages", STAGES, STAGE_SYNONYMS, None),
        ("business_models", BUSINESS_MODELS, BUSINESS_MODEL_SYNONYMS, None),
        ("exit_statuses", EXIT_STATUSES, EXIT_SYNONYMS, EXIT_MULTI),
    ]
    for field, canon, synonyms, multi in list_specs:
        normalized = _normalize_list(extracted.get(field), canon, synonyms, multi)
        if normalized:
            out[field] = normalized

    # Common model mistake: a region/sub-sector value landing in "countries".
    # Re-route any unmatched country token to region / sub-sector if it fits.
    raw_countries = extracted.get("countries")
    if raw_countries is not None:
        leftovers = [
            c for c in (raw_countries if isinstance(raw_countries, list) else [raw_countries])
            if isinstance(c, str) and c.strip() and not _canon_match(c, vocab["countries"], COUNTRY_SYNONYMS)
        ]
        for token in leftovers:
            as_region = _canon_match(token, vocab["regions"], REGION_SYNONYMS)
            if as_region:
                out.setdefault("regions", [])
                for r in as_region:
                    if r not in out["regions"]:
                        out["regions"].append(r)
                continue
            as_sub = _canon_match(token, vocab["sub_sectors"], {})
            if as_sub:
                out.setdefault("sub_sectors", [])
                for s in as_sub:
                    if s not in out["sub_sectors"]:
                        out["sub_sectors"].append(s)

    # tech_enabled
    tech = _coerce_bool(extracted.get("tech_enabled"))
    if tech is not None:
        out["tech_enabled"] = tech

    # numeric ranges
    for key in NUMERIC_FIELDS:
        if key in extracted and extracted[key] is not None:
            num = _coerce_number(key, extracted[key])
            if num is not None:
                out[key] = num

    return out


# ── System prompt ─────────────────────────────────────────────────────────────
def build_system_prompt(vocab: dict[str, list[str]]) -> str:
    sectors = ", ".join(vocab["sectors"])
    countries = ", ".join(vocab["countries"])
    regions = ", ".join(vocab["regions"])
    sub_sectors = ", ".join(vocab["sub_sectors"])

    return f"""You are a precise filter-extraction engine for a startup investment database.
Convert the investor's natural-language query into ONE JSON object of filter
parameters. Filters are combined with AND logic against a SQL database, exactly
like the manual filter panel. Output ONLY the JSON object — no prose, no markdown.

== ALLOWED FIELDS (omit any you cannot infer; NEVER invent values) ==
Categorical (arrays of EXACT strings from these lists):
- "sectors": {sectors}
- "sub_sectors": {sub_sectors}
- "countries": {countries}
- "regions": {regions}
- "stages": creation, development, restructuring
- "business_models": B2B, B2C, B2B2C, Marketplace
- "exit_statuses": active, failed, acquired, ipo
- "tech_enabled": true | false

Numeric ranges (always use the min_/max_ prefix; UNITS MATTER):
- min_employees, max_employees           (headcount, integer)
- min_founded_year, max_founded_year     (calendar year, e.g. 2019)
- min_age_years, max_age_years           (company age in years)
- min_revenue_usd, max_revenue_usd       (annual revenue, ABSOLUTE US dollars)
- min_revenue_cagr, max_revenue_cagr     (3-yr revenue growth, PERCENT 0-100)
- min_ebitda_margin, max_ebitda_margin   (EBITDA margin, PERCENT, may be negative)
- min_market_size_M, max_market_size_M   (TAM in MILLIONS of USD)
- min_market_growth_rate, max_market_growth_rate (PERCENT)
- min_competition_intensity, max_competition_intensity (scale 0-10, lower = less competition)
- min_regulatory_stability, max_regulatory_stability   (scale 0-10, higher = more stable)
- min_esg_score, max_esg_score           (scale 0-10)

== UNIT RULES ==
- Percentages are whole numbers: "40% growth" -> 40 (NOT 0.40).
- Revenue is absolute USD: "$1M" -> 1000000, "$500k" -> 500000, "2 million" -> 2000000.
- Market size / TAM is in MILLIONS: "$1 billion market" -> 1000, "$500M TAM" -> 500.
- competition_intensity, regulatory_stability, esg_score are all on a 0-10 scale.
- A country name (e.g. Kenya) goes in "countries"; a region (e.g. MENA, East Africa)
  goes in "regions". Never put a region in "countries".

== QUALITATIVE LANGUAGE -> THRESHOLDS ==
Growth:
- "high growth"/"fast-growing"/"hyper-growth"/"strong growth" -> min_revenue_cagr: 40
- "moderate growth" -> min_revenue_cagr: 20
- "low"/"slow growth" -> max_revenue_cagr: 15
Profitability:
- "profitable"/"in the black" -> min_ebitda_margin: 0
- "highly profitable" -> min_ebitda_margin: 15
- "unprofitable"/"loss-making"/"burning cash" -> max_ebitda_margin: 0
Risk (this database defines risk via competition + regulation):
- "low risk"/"safe"/"stable" -> min_regulatory_stability: 6, max_competition_intensity: 5
- "high risk"/"risky" -> max_regulatory_stability: 4
- "low competition"/"little competition"/"blue ocean" -> max_competition_intensity: 3
- "high competition"/"crowded"/"saturated" -> min_competition_intensity: 7
- "stable regulation"/"strong regulatory environment" -> min_regulatory_stability: 7
Sustainability:
- "high ESG"/"sustainable"/"strong governance" (the quality, not the energy sector) -> min_esg_score: 7
Market:
- "large"/"big market"/"huge TAM" -> min_market_size_M: 1000
- "fast-growing market" -> min_market_growth_rate: 25
Size & maturity:
- "small team"/"small company"/"lean" -> max_employees: 20
- "mid-sized" -> min_employees: 20, max_employees: 100
- "large company"/"big team" -> min_employees: 100
- "early stage"/"seed"/"idea stage" -> stages: ["creation"]
- "growth stage"/"scaling" -> stages: ["development"]
- "turnaround"/"distressed"/"restructuring" -> stages: ["restructuring"]
- "young"/"new"/"recently founded" -> min_founded_year: 2020
- "mature"/"established"/"old" -> max_founded_year: 2016
Exit:
- "exited"/"successful exit" -> exit_statuses: ["acquired", "ipo"]
- "acquired"/"bought" -> exit_statuses: ["acquired"]
- "IPO"/"went public"/"listed" -> exit_statuses: ["ipo"]
- "failed"/"shut down"/"bankrupt" -> exit_statuses: ["failed"]
- "active"/"still operating" -> exit_statuses: ["active"]

== EXAMPLES ==
Query: "fintech startups in Morocco with low risk and high growth"
JSON: {{"sectors":["Fintech"],"countries":["Morocco"],"min_regulatory_stability":6,"max_competition_intensity":5,"min_revenue_cagr":40}}

Query: "profitable B2B SaaS in Kenya or Nigeria growing more than 50%"
JSON: {{"sectors":["SaaS"],"business_models":["B2B"],"countries":["Kenya","Nigeria"],"min_ebitda_margin":0,"min_revenue_cagr":50}}

Query: "early-stage agritech in East Africa with a small team"
JSON: {{"sectors":["Agritech"],"regions":["East Africa"],"stages":["creation"],"max_employees":20}}

Query: "mature ecommerce companies that have exited"
JSON: {{"sectors":["E-commerce"],"max_founded_year":2016,"exit_statuses":["acquired","ipo"]}}

Query: "tech-enabled marketplaces founded after 2019 targeting a billion-dollar market"
JSON: {{"business_models":["Marketplace"],"tech_enabled":true,"min_founded_year":2019,"min_market_size_M":1000}}

Query: "failed logistics startups"
JSON: {{"sectors":["Logistics"],"exit_statuses":["failed"]}}

Query: "telemedicine companies with strong ESG and over $1M revenue"
JSON: {{"sub_sectors":["Telemedicine"],"min_esg_score":7,"min_revenue_usd":1000000}}

Query: "low competition sectors with high ESG scores in MENA"
JSON: {{"regions":["MENA"],"max_competition_intensity":3,"min_esg_score":7}}

Query: "show me everything"
JSON: {{}}

Return ONLY the JSON object."""
