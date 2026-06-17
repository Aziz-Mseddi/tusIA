from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime


class StartupBase(BaseModel):
    id: int
    name: str
    country: str
    region: str
    sector: str
    sub_sector: Optional[str]
    stage: str
    founded_year: int
    age_years: float
    employees: int
    annual_revenue_usd: Optional[float]
    revenue_cagr_3y: Optional[float]
    ebitda_margin: Optional[float]
    total_addressable_market_M: Optional[float]
    market_growth_rate: Optional[float]
    competition_intensity: Optional[float]
    regulatory_stability: Optional[float]
    debt_to_ebitda: Optional[float]
    current_ratio: Optional[float]
    local_infrastructure: Optional[float]
    esg_score: Optional[float]
    business_model: str
    tech_enabled: bool
    exit_status: str
    failure_reason: Optional[str]
    description: Optional[str]
    tags: Optional[str]

    class Config:
        from_attributes = True


# Mode I schemas

class FilterRequest(BaseModel):
    # Categorical
    sectors: Optional[List[str]] = None
    countries: Optional[List[str]] = None
    regions: Optional[List[str]] = None
    stages: Optional[List[str]] = None
    business_models: Optional[List[str]] = None
    exit_statuses: Optional[List[str]] = None
    sub_sectors: Optional[List[str]] = None
    tech_enabled: Optional[bool] = None
    # Size
    min_employees: Optional[int] = None
    max_employees: Optional[int] = None
    min_founded_year: Optional[int] = None
    max_founded_year: Optional[int] = None
    min_age_years: Optional[float] = None
    max_age_years: Optional[float] = None
    # Financial
    min_revenue_usd: Optional[float] = None
    max_revenue_usd: Optional[float] = None
    min_revenue_cagr: Optional[float] = None
    max_revenue_cagr: Optional[float] = None
    min_ebitda_margin: Optional[float] = None
    max_ebitda_margin: Optional[float] = None
    # Market
    min_market_size_M: Optional[float] = None
    max_market_size_M: Optional[float] = None
    min_market_growth_rate: Optional[float] = None
    max_market_growth_rate: Optional[float] = None
    min_competition_intensity: Optional[float] = None
    max_competition_intensity: Optional[float] = None
    # Risk & Quality
    min_regulatory_stability: Optional[float] = None
    max_regulatory_stability: Optional[float] = None
    min_esg_score: Optional[float] = None
    max_esg_score: Optional[float] = None


class PromptFilterRequest(BaseModel):
    prompt: str


class ExplainRequest(BaseModel):
    startup_id: int
    question: str


class SuggestionExplainRequest(BaseModel):
    theme: str
    rationale: str
    supporting_sectors: list[str] = []
    risk_level: Optional[str] = None


class SuggestionAskRequest(BaseModel):
    question: str
    suggestions: list[dict] = []


# Mode II schemas

class StartupProfile(BaseModel):
    name: Optional[str] = None
    sector: Optional[str] = None
    sub_sector: Optional[str] = None
    stage: Optional[str] = None
    business_model: Optional[str] = None
    tech_enabled: Optional[bool] = None
    employees_estimate: Optional[int] = None
    revenue_estimate_usd: Optional[float] = None
    description: Optional[str] = None
    tags: Optional[List[str]] = None
    target_market: Optional[str] = None
    key_product: Optional[str] = None


class FindAnaloguesRequest(BaseModel):
    profile: Dict[str, Any]


class AnaloguesSummary(BaseModel):
    total_analogues: int
    countries_represented: int
    success_rate_percent: float
    failure_rate_percent: float
    top_failure_reasons: List[str]
    top_success_signals: List[str]
    countries: List[str]
    avg_score_by_country: Dict[str, float]


class ViabilityVerdictRequest(BaseModel):
    profile: Dict[str, Any]
    analogues_summary: AnaloguesSummary


class ExplainAnalogueRequest(BaseModel):
    startup_id: int
    question: str
    tunisian_profile_summary: str


class FounderQuestionsRequest(BaseModel):
    profile: Dict[str, Any]
    analogues_summary: AnaloguesSummary


class FounderQuestion(BaseModel):
    theme: str
    question: str
    gap: str
    why_it_matters: str


class FounderQuestionsResponse(BaseModel):
    questions: List[FounderQuestion]


class FindAnaloguesBatchRequest(BaseModel):
    profiles: List[Dict[str, Any]]


class ViabilityVerdictBatchItem(BaseModel):
    name: str
    profile: Dict[str, Any]
    analogues_summary: AnaloguesSummary


class ViabilityVerdictBatchRequest(BaseModel):
    items: List[ViabilityVerdictBatchItem]


class Mode2AssessmentCreate(BaseModel):
    title: Optional[str] = None
    is_multiple: bool = False
    profile: Any                         # dict (single) or list[dict] (multi)
    analogues: Optional[Any] = None
    verdict: Optional[Any] = None
    source_filenames: Optional[List[str]] = None


class Mode2AssessmentSummary(BaseModel):
    id: int
    created_at: datetime
    title: str
    is_multiple: bool
    headline: Optional[str] = None


class Mode2AssessmentDetail(BaseModel):
    id: int
    created_at: datetime
    title: str
    is_multiple: bool
    profile: Any
    analogues: Optional[Any] = None
    verdict: Optional[Any] = None
    source_filenames: Optional[List[str]] = None


# Settings schemas (per-user cloud LLM key)

class ApiKeyUpdate(BaseModel):
    openrouter_api_key: str


class SettingsResponse(BaseModel):
    openrouter_key_set: bool
    openrouter_key_masked: Optional[str] = None
