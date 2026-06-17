from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from schemas import ApiKeyUpdate, SettingsResponse
from routers.auth import require_investor, Investor

router = APIRouter(prefix="/api/v1/settings", tags=["settings"])


def _mask(key: str | None) -> str | None:
    if not key:
        return None
    return f"…{key[-4:]}" if len(key) >= 4 else "…"


@router.get("", response_model=SettingsResponse)
def get_settings(investor: Investor = Depends(require_investor)):
    return SettingsResponse(
        openrouter_key_set=bool(investor.openrouter_api_key),
        openrouter_key_masked=_mask(investor.openrouter_api_key),
    )


@router.put("/api-key", response_model=SettingsResponse)
def save_api_key(
    body: ApiKeyUpdate,
    investor: Investor = Depends(require_investor),
    db: Session = Depends(get_db),
):
    key = body.openrouter_api_key.strip()
    if not key:
        raise HTTPException(400, detail="API key cannot be empty")
    investor.openrouter_api_key = key
    db.commit()
    return SettingsResponse(openrouter_key_set=True, openrouter_key_masked=_mask(key))


@router.delete("/api-key", response_model=SettingsResponse)
def clear_api_key(
    investor: Investor = Depends(require_investor),
    db: Session = Depends(get_db),
):
    investor.openrouter_api_key = None
    db.commit()
    return SettingsResponse(openrouter_key_set=False, openrouter_key_masked=None)
