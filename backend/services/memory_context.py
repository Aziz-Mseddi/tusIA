"""
Builds a compact text dump of an investor's persistent chat memory — saved
PV / board-minute templates and free-text context items. Injected into the
chat assistant's system prompt when the user enables the "Memory" toggle
(local Ollama only), so the model can reference the investor's own reference
formats and notes on every message.
"""
from sqlalchemy.orm import Session

from models import ChatMemoryItem, ChatMemorySection, Investor

SECTION_LABELS = {
    "pv_template": "PV templates",
    "board_minutes": "Board / minute-meeting templates",
    "general_context": "General context memory",
}

MAX_CONTEXT_CHARS = 12_000


def build_memory_context(investor: Investor, db: Session) -> str:
    enabled_sections = {
        s.section
        for s in db.query(ChatMemorySection).filter_by(investor_id=investor.id, enabled=True).all()
    }
    # Sections with no row yet default to enabled.
    seen_sections = {
        s.section for s in db.query(ChatMemorySection).filter_by(investor_id=investor.id).all()
    }
    for key in SECTION_LABELS:
        if key not in seen_sections:
            enabled_sections.add(key)

    if not enabled_sections:
        return ""

    blocks = []
    total_chars = 0
    for key, label in SECTION_LABELS.items():
        if key not in enabled_sections:
            continue
        items = (
            db.query(ChatMemoryItem)
            .filter_by(investor_id=investor.id, section=key, enabled=True)
            .order_by(ChatMemoryItem.created_at)
            .all()
        )
        if not items:
            continue
        lines = [f"### {label}"]
        for item in items:
            entry = f"-- {item.title} --\n{item.content}"
            if total_chars + len(entry) > MAX_CONTEXT_CHARS:
                remaining = MAX_CONTEXT_CHARS - total_chars
                if remaining <= 0:
                    break
                entry = entry[:remaining] + "\n[...truncated]"
            lines.append(entry)
            total_chars += len(entry)
        blocks.append("\n\n".join(lines))
        if total_chars >= MAX_CONTEXT_CHARS:
            break

    return "\n\n".join(blocks)
