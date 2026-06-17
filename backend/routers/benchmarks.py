"""
Benchmarks router — view and update African market reference values.
GET  /api/v1/benchmarks          → list all benchmarks
PUT  /api/v1/benchmarks/{name}   → update avg / best / is_negative for one metric
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models import MetricsBenchmark

router = APIRouter(prefix="/api/v1/benchmarks", tags=["benchmarks"])


class BenchmarkUpdate(BaseModel):
    african_avg:  float
    african_best: float
    is_negative:  bool
    description:  str | None = None


@router.get("")
def list_benchmarks(db: Session = Depends(get_db)):
    rows = db.query(MetricsBenchmark).order_by(MetricsBenchmark.metric_name).all()
    return [
        {
            "metric_name":  r.metric_name,
            "african_avg":  r.african_avg,
            "african_best": r.african_best,
            "is_negative":  r.is_negative,
            "description":  r.description,
        }
        for r in rows
    ]


@router.put("/{metric_name}")
def update_benchmark(
    metric_name: str,
    body: BenchmarkUpdate,
    db: Session = Depends(get_db),
):
    row = db.query(MetricsBenchmark).filter(
        MetricsBenchmark.metric_name == metric_name
    ).first()

    if not row:
        raise HTTPException(404, detail=f"Benchmark '{metric_name}' not found")

    row.african_avg  = body.african_avg
    row.african_best = body.african_best
    row.is_negative  = body.is_negative
    if body.description is not None:
        row.description = body.description

    db.commit()
    db.refresh(row)
    return {
        "metric_name":  row.metric_name,
        "african_avg":  row.african_avg,
        "african_best": row.african_best,
        "is_negative":  row.is_negative,
        "description":  row.description,
    }
