from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models import ChatMemoryItem, ChatMemorySection
from routers.auth import require_investor, Investor
from services.memory_context import SECTION_LABELS

router = APIRouter(prefix="/api/v1/chat/memory", tags=["chat-memory"])

VALID_SECTIONS = set(SECTION_LABELS.keys())


# ── Schemas ───────────────────────────────────────────────────────────────────

class MemoryItemCreate(BaseModel):
    section: str
    title: str
    content: str


class MemoryItemUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    enabled: Optional[bool] = None


class SectionToggle(BaseModel):
    enabled: bool


class MasterToggle(BaseModel):
    enabled: bool


def _validate_section(section: str) -> None:
    if section not in VALID_SECTIONS:
        raise HTTPException(400, detail={
            "error": "Invalid section",
            "detail": f"section must be one of {sorted(VALID_SECTIONS)}",
        })


def _section_enabled_map(investor_id: int, db: Session) -> dict[str, bool]:
    rows = db.query(ChatMemorySection).filter_by(investor_id=investor_id).all()
    enabled = {key: True for key in SECTION_LABELS}  # default enabled until a row exists
    for row in rows:
        enabled[row.section] = row.enabled
    return enabled


def _item_out(item: ChatMemoryItem) -> dict:
    return {
        "id": item.id,
        "title": item.title,
        "content": item.content,
        "enabled": item.enabled,
        "chars": len(item.content),
    }


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("")
def get_memory(
    investor: Investor = Depends(require_investor),
    db: Session = Depends(get_db),
):
    enabled_map = _section_enabled_map(investor.id, db)
    items = (
        db.query(ChatMemoryItem)
        .filter_by(investor_id=investor.id)
        .order_by(ChatMemoryItem.created_at)
        .all()
    )
    sections = []
    for key, label in SECTION_LABELS.items():
        sections.append({
            "key": key,
            "label": label,
            "enabled": enabled_map[key],
            "items": [_item_out(i) for i in items if i.section == key],
        })
    return {"sections": sections}


@router.post("/items")
def create_item(
    body: MemoryItemCreate,
    investor: Investor = Depends(require_investor),
    db: Session = Depends(get_db),
):
    _validate_section(body.section)
    title = body.title.strip()
    content = body.content.strip()
    if not title or not content:
        raise HTTPException(400, detail={"error": "Bad request", "detail": "title and content are required"})

    item = ChatMemoryItem(
        investor_id=investor.id,
        section=body.section,
        title=title,
        content=content,
        enabled=True,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return _item_out(item)


@router.put("/items/{item_id}")
def update_item(
    item_id: int,
    body: MemoryItemUpdate,
    investor: Investor = Depends(require_investor),
    db: Session = Depends(get_db),
):
    item = (
        db.query(ChatMemoryItem)
        .filter(ChatMemoryItem.id == item_id, ChatMemoryItem.investor_id == investor.id)
        .first()
    )
    if not item:
        raise HTTPException(404, detail="Memory item not found")

    if body.title is not None:
        title = body.title.strip()
        if not title:
            raise HTTPException(400, detail={"error": "Bad request", "detail": "title cannot be empty"})
        item.title = title
    if body.content is not None:
        content = body.content.strip()
        if not content:
            raise HTTPException(400, detail={"error": "Bad request", "detail": "content cannot be empty"})
        item.content = content
    if body.enabled is not None:
        item.enabled = body.enabled

    item.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(item)
    return _item_out(item)


@router.delete("/items/{item_id}")
def delete_item(
    item_id: int,
    investor: Investor = Depends(require_investor),
    db: Session = Depends(get_db),
):
    item = (
        db.query(ChatMemoryItem)
        .filter(ChatMemoryItem.id == item_id, ChatMemoryItem.investor_id == investor.id)
        .first()
    )
    if not item:
        raise HTTPException(404, detail="Memory item not found")

    db.delete(item)
    db.commit()
    return {"ok": True}


@router.put("/sections/{section}")
def toggle_section(
    section: str,
    body: SectionToggle,
    investor: Investor = Depends(require_investor),
    db: Session = Depends(get_db),
):
    _validate_section(section)
    row = (
        db.query(ChatMemorySection)
        .filter_by(investor_id=investor.id, section=section)
        .first()
    )
    if row:
        row.enabled = body.enabled
    else:
        row = ChatMemorySection(investor_id=investor.id, section=section, enabled=body.enabled)
        db.add(row)
    db.commit()
    return {"key": section, "enabled": body.enabled}


@router.post("/master")
def set_master(
    body: MasterToggle,
    investor: Investor = Depends(require_investor),
    db: Session = Depends(get_db),
):
    for key in SECTION_LABELS:
        row = (
            db.query(ChatMemorySection)
            .filter_by(investor_id=investor.id, section=key)
            .first()
        )
        if row:
            row.enabled = body.enabled
        else:
            db.add(ChatMemorySection(investor_id=investor.id, section=key, enabled=body.enabled))
    db.commit()
    return {"enabled": body.enabled}
