"""
TunisIA Scoring Engine — v2
African-benchmark normalisation · weighted pillars · VC-style penalty system.

Pillar weights
──────────────
  Growth          40 %  → revenue_cagr_3y (15 %), market_growth_rate (10 %), TAM (15 %)
  Financial       30 %  → ebitda_margin   (10 %), debt_to_ebitda     (10 %), current_ratio (10 %)
  Risk            20 %  → competition_intensity (10 %), regulatory_stability (10 %)
  ESG             10 %  → esg_score (10 %)

Normalisation (per metric)
──────────────────────────
  score = 50 + 50 × (value − avg) / (best − avg)      positive metrics
  score = 50 + 50 × (avg  − value) / (avg  − best)    negative metrics (lower = better)
  → clamped to [0, 100]   (50 = African average, 100 = African best-in-class)

Penalties (subtracted from weighted base score, then clamped to [0, 100])
──────────────────────────────────────────────────────────────────────────
  current_ratio  < 1.0          → −5   (liquidity crisis)
  debt_to_ebitda > 8.0          → −8   (extreme leverage)
  ebitda_margin  < −20 %        → −10  (operational distress)
  missing fields (each, max −15)→ −3   (data-quality discount)
"""
from __future__ import annotations

from typing import Optional

# ── African Benchmark Constants ─────────────────────────────────────────────
# Each entry: { "avg": float, "best": float, "is_negative": bool }
# is_negative=True  → lower value is better (debt, competition)
# is_negative=False → higher value is better

DEFAULT_BENCHMARKS: dict[str, dict] = {
    "revenue_cagr_3y": {
        "avg":  15.0,    # typical CAGR for African growth-stage startups
        "best": 80.0,    # hyper-growth tier (Flutterwave / Paystack era)
        "is_negative": False,
    },
    "ebitda_margin": {
        "avg":  8.0,     # thin margins common across the continent
        "best": 42.0,    # mature, profitable SaaS / niche-monopoly tier
        "is_negative": False,
    },
    "total_addressable_market_M": {
        "avg":  150.0,   # conservative SAM for most African sectors
        "best": 2000.0,  # continental-scale fintech / agritech opportunity
        "is_negative": False,
    },
    "market_growth_rate": {
        "avg":  12.0,    # broad emerging-market average
        "best": 45.0,    # fastest-growing sectors (mobile money, agritech)
        "is_negative": False,
    },
    "competition_intensity": {
        "avg":  6.0,     # moderate competition on 0–10 scale
        "best": 1.5,     # near-monopoly / greenfield market
        "is_negative": True,
    },
    "regulatory_stability": {
        "avg":  5.5,     # variable environment across the continent
        "best": 9.0,     # Mauritius / Rwanda regulatory quality tier
        "is_negative": False,
    },
    "debt_to_ebitda": {
        "avg":  4.0,     # 4× leverage common for mid-stage companies
        "best": 0.5,     # nearly debt-free; best structural position
        "is_negative": True,
    },
    "current_ratio": {
        "avg":  1.2,     # tight liquidity; many African firms run lean
        "best": 4.0,     # strong cash buffer
        "is_negative": False,
    },
    "esg_score": {
        "avg":  5.5,     # mid-range adoption; ESG still emerging in Africa
        "best": 9.5,     # top reporters, GRI-aligned
        "is_negative": False,
    },
}

# Within-pillar relative weights (must sum to 1.0 per pillar)
_PILLAR_WEIGHTS = {
    "growth": {
        "revenue_cagr_3y":            15 / 40,  # 37.5 %
        "market_growth_rate":         10 / 40,  # 25.0 %
        "total_addressable_market_M": 15 / 40,  # 37.5 %
    },
    "financial": {
        "ebitda_margin":   1 / 3,
        "debt_to_ebitda":  1 / 3,
        "current_ratio":   1 / 3,
    },
    "risk": {
        "competition_intensity": 0.5,
        "regulatory_stability":  0.5,
    },
    "esg": {
        "esg_score": 1.0,
    },
}

# Cross-pillar weights (must sum to 1.0)
_CROSS_WEIGHTS = {
    "growth":    0.40,
    "financial": 0.30,
    "risk":      0.20,
    "esg":       0.10,
}


# ── Core helpers ─────────────────────────────────────────────────────────────

def normalize_metric(
    value: float,
    avg: float,
    best: float,
    is_negative: bool = False,
) -> float:
    """
    Map a raw metric to [0, 100] using African-market anchors.
    50 = continent average; 100 = best-in-class.
    """
    if is_negative:
        denom = avg - best          # positive because avg > best for cost metrics
        if denom == 0:
            return 50.0
        score = 50.0 + 50.0 * ((avg - value) / denom)
    else:
        denom = best - avg
        if denom == 0:
            return 50.0
        score = 50.0 + 50.0 * ((value - avg) / denom)
    return max(0.0, min(100.0, score))


def _weighted_pillar(
    metric_values: dict[str, Optional[float]],
    pillar_weights: dict[str, float],
    benchmarks: dict[str, dict],
) -> Optional[float]:
    """
    Compute a weighted pillar score in [0, 100].
    Missing metrics are excluded and their weights redistributed.
    Returns None when no metrics are available at all.
    """
    available: dict[str, float] = {}
    for metric, _ in pillar_weights.items():
        v = metric_values.get(metric)
        if v is not None:
            bm = benchmarks[metric]
            available[metric] = normalize_metric(
                v, bm["avg"], bm["best"], bm["is_negative"]
            )

    if not available:
        return None

    total_w = sum(pillar_weights[k] for k in available)
    return sum((pillar_weights[k] / total_w) * available[k] for k in available)


def _compute_penalties(
    revenue_cagr_3y: Optional[float],
    ebitda_margin: Optional[float],
    total_addressable_market_M: Optional[float],
    market_growth_rate: Optional[float],
    competition_intensity: Optional[float],
    regulatory_stability: Optional[float],
    debt_to_ebitda: Optional[float],
    current_ratio: Optional[float],
    esg_score: Optional[float],
) -> tuple[float, list[str]]:
    """
    Returns (total_penalty_points, list_of_vc_analyst_notes).
    Mirrors how a VC red-flags structural risks before signing a term sheet.
    """
    penalty = 0.0
    reasons: list[str] = []

    # Liquidity crisis: unable to cover current obligations
    if current_ratio is not None and current_ratio < 1.0:
        penalty += 5.0
        reasons.append(
            f"Liquidity stress — current_ratio {current_ratio:.2f} < 1.0 "
            f"signals inability to cover short-term obligations (-5 pts)"
        )

    # Extreme leverage: covenant-breach territory in most African debt markets
    if debt_to_ebitda is not None and debt_to_ebitda > 8.0:
        penalty += 8.0
        reasons.append(
            f"Extreme leverage — debt/EBITDA {debt_to_ebitda:.1f}× far exceeds "
            f"the 4–5× ceiling typical for African lenders (-8 pts)"
        )

    # Operational distress: deep cash burn unrecoverable without external capital
    if ebitda_margin is not None and ebitda_margin < -20.0:
        penalty += 10.0
        reasons.append(
            f"Operational distress — EBITDA margin {ebitda_margin:.1f}% "
            f"implies unsustainable cash burn rate (-10 pts)"
        )

    # Data-quality discount: missing inputs reduce scoring confidence
    critical_fields = [
        revenue_cagr_3y, ebitda_margin, total_addressable_market_M,
        market_growth_rate, competition_intensity, regulatory_stability,
        debt_to_ebitda, current_ratio, esg_score,
    ]
    missing = sum(1 for x in critical_fields if x is None)
    if missing > 0:
        data_penalty = min(15.0, missing * 3.0)
        penalty += data_penalty
        reasons.append(
            f"Incomplete profile — {missing}/9 key inputs missing; "
            f"scoring confidence reduced (−{data_penalty:.0f} pts)"
        )

    return round(penalty, 2), reasons


# ── Public API ────────────────────────────────────────────────────────────────

def score_company(
    stage: str,
    age_years: float = None,
    revenue_cagr_3y: float = None,
    ebitda_margin: float = None,
    total_addressable_market_M: float = None,
    market_growth_rate: float = None,
    competition_intensity: float = None,
    regulatory_stability: float = None,
    debt_to_ebitda: float = None,
    current_ratio: float = None,
    local_infrastructure: float = None,   # kept for signature compat; not scored
    esg_score: float = None,
    benchmarks: dict | None = None,
) -> dict:
    """
    Score a startup 0–100 using African-market benchmarks.
    Returns a dict fully compatible with the existing ScoreResult schema.

    Pillar → output key mapping (frontend compat)
    ─────────────────────────────────────────────
      pillars["execution"] = Growth pillar  (40 %)
      pillars["market"]    = Risk pillar    (20 %)
      pillars["financial"] = Financial      (30 %)
      pillars["external"]  = ESG pillar     (10 %)
    """
    bm = benchmarks or DEFAULT_BENCHMARKS

    metric_values: dict[str, Optional[float]] = {
        "revenue_cagr_3y":            revenue_cagr_3y,
        "market_growth_rate":         market_growth_rate,
        "total_addressable_market_M": total_addressable_market_M,
        "ebitda_margin":              ebitda_margin,
        "debt_to_ebitda":             debt_to_ebitda,
        "current_ratio":              current_ratio,
        "competition_intensity":      competition_intensity,
        "regulatory_stability":       regulatory_stability,
        "esg_score":                  esg_score,
    }

    # ── Step 1: pillar scores [0, 100] ────────────────────────────────────────
    pillar_growth    = _weighted_pillar(metric_values, _PILLAR_WEIGHTS["growth"],    bm)
    pillar_financial = _weighted_pillar(metric_values, _PILLAR_WEIGHTS["financial"], bm)
    pillar_risk      = _weighted_pillar(metric_values, _PILLAR_WEIGHTS["risk"],      bm)
    pillar_esg       = _weighted_pillar(metric_values, _PILLAR_WEIGHTS["esg"],       bm)

    # ── Step 2: cross-pillar weighted base score [0, 100] ────────────────────
    available_pillars = {
        "growth":    pillar_growth,
        "financial": pillar_financial,
        "risk":      pillar_risk,
        "esg":       pillar_esg,
    }
    present = {k: v for k, v in available_pillars.items() if v is not None}

    if present:
        total_w = sum(_CROSS_WEIGHTS[k] for k in present)
        base_score = sum((_CROSS_WEIGHTS[k] / total_w) * present[k] for k in present)
    else:
        base_score = 25.0   # floor: no data → very poor score

    # ── Step 3: penalties ─────────────────────────────────────────────────────
    penalty, penalty_notes = _compute_penalties(
        revenue_cagr_3y, ebitda_margin, total_addressable_market_M,
        market_growth_rate, competition_intensity, regulatory_stability,
        debt_to_ebitda, current_ratio, esg_score,
    )
    final_score = max(0.0, min(100.0, base_score - penalty))

    # ── Step 4: environment factor (market-friendliness, 0.60–1.00) ──────────
    comp_val = competition_intensity if competition_intensity is not None else 6.0
    reg_val  = regulatory_stability  if regulatory_stability  is not None else 5.5
    env_factor = 0.60 + 0.20 * (1.0 - comp_val / 10.0) + 0.20 * (reg_val / 10.0)
    env_factor = max(0.60, min(1.00, env_factor))
    if stage == "restructuring":
        env_factor = min(env_factor, 0.85)

    # ── Step 5: grade & decision zone ─────────────────────────────────────────
    grade = (
        "A" if final_score >= 80 else
        "B" if final_score >= 65 else
        "C" if final_score >= 50 else
        "D" if final_score >= 35 else
        "F"
    )

    # ── Step 6: risk score ────────────────────────────────────────────────────
    base_risk = {"creation": 55, "development": 26, "restructuring": 70}.get(stage, 45)
    risk_mod = 0
    if pillar_growth    is not None and pillar_growth    < 40: risk_mod += 15
    if pillar_financial is not None and pillar_financial < 40: risk_mod += 20
    if pillar_risk      is not None and pillar_risk      < 40: risk_mod += 10
    if pillar_esg       is not None and pillar_esg       < 40: risk_mod +=  5
    risk_total = min(95.0, (base_risk + risk_mod) * (2.0 - env_factor))
    risk_level = "Low" if risk_total < 30 else ("Medium" if risk_total < 60 else "High")

    if final_score >= 70 and risk_total < 30:
        decision_zone = "Green"
    elif final_score < 40 or risk_total >= 60:
        decision_zone = "Red"
    else:
        decision_zone = "Orange"

    # ── Step 7: annualised ROI estimate ───────────────────────────────────────
    g = (pillar_growth    or 50.0) / 100.0
    f = (pillar_financial or 50.0) / 100.0

    if stage == "creation":
        base_roi = 0.30 * g
    elif stage == "development":
        base_roi = 0.15 * g + 0.10 * f
    else:                                   # restructuring
        if pillar_financial is not None and pillar_financial >= 70:
            base_roi = 0.15
        elif pillar_financial is not None and pillar_financial >= 50:
            base_roi = 0.05
        else:
            base_roi = -0.10
    estimated_roi = base_roi * env_factor

    # ── Step 8: individual normalized scores for transparency ─────────────────
    def _n(metric: str) -> Optional[float]:
        v = metric_values.get(metric)
        if v is None:
            return None
        b = bm[metric]
        return round(normalize_metric(v, b["avg"], b["best"], b["is_negative"]), 2)

    return {
        "final_score":   round(final_score, 2),
        "grade":         grade,
        "decision_zone": decision_zone,
        "risk_total":    round(risk_total, 2),
        "risk_level":    risk_level,
        "estimated_roi": round(estimated_roi, 4),
        "env_factor":    round(env_factor, 4),
        "raw_score":     round(base_score / 10.0, 4),   # 0-10 for UI compat
        "pillars": {
            # Key mapping preserved for frontend ScoreResult compatibility:
            #   execution → Growth pillar  (40 %)
            #   market    → Risk pillar    (20 %)
            #   financial → Financial      (30 %)
            #   external  → ESG pillar     (10 %)
            "execution": round(pillar_growth    / 10.0, 4) if pillar_growth    is not None else None,
            "market":    round((pillar_risk or 50.0) / 10.0, 4),
            "financial": round(pillar_financial / 10.0, 4) if pillar_financial is not None else None,
            "external":  round(pillar_esg       / 10.0, 4) if pillar_esg       is not None else None,
        },
        "notes": {
            # Per-metric normalized scores (0-100); transparent for AI explain
            "growth_score":       _n("revenue_cagr_3y"),
            "market_growth_norm": _n("market_growth_rate"),
            "tam_score":          _n("total_addressable_market_M"),
            "margin_score":       _n("ebitda_margin"),
            "debt_score":         _n("debt_to_ebitda"),
            "liquidity_score":    _n("current_ratio"),
            "comp_score":         _n("competition_intensity"),
            "reg_score":          _n("regulatory_stability"),
            "esg_norm":           _n("esg_score"),
            "penalty_total":      round(penalty, 2),
            "penalty_reasons":    penalty_notes,
        },
    }


# ── Dynamic benchmark loading from DB ────────────────────────────────────────

def load_benchmarks_from_db(db) -> dict:
    """
    Load per-metric benchmarks from the metrics_benchmarks table.
    Falls back to DEFAULT_BENCHMARKS for any row not present in the DB.
    Usage: benchmarks = load_benchmarks_from_db(db); score_company(..., benchmarks=benchmarks)
    """
    from models import MetricsBenchmark  # local import avoids circular dependency

    rows = db.query(MetricsBenchmark).all()
    if not rows:
        return DEFAULT_BENCHMARKS

    result = dict(DEFAULT_BENCHMARKS)
    for row in rows:
        result[row.metric_name] = {
            "avg":         row.african_avg,
            "best":        row.african_best,
            "is_negative": row.is_negative,
        }
    return result


# ── Quick smoke-test ──────────────────────────────────────────────────────────

if __name__ == "__main__":
    import json

    result = score_company(
        stage="development",
        age_years=5,
        revenue_cagr_3y=45,
        ebitda_margin=12,
        total_addressable_market_M=500,
        market_growth_rate=25,
        competition_intensity=6,
        regulatory_stability=7,
        debt_to_ebitda=2,
        current_ratio=3,
        local_infrastructure=6,
        esg_score=7,
    )
    print(json.dumps(result, indent=2))
