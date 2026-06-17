from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, UploadFile, File
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models import ChatSession, ChatMessageRecord
from services.pdf_service import markdown_to_pdf_bytes
from services.ollama_service import chat_with_history, OllamaTimeoutError, OllamaUnavailableError
from services.openrouter_service import (
    chat_with_history as openrouter_chat_with_history,
    OpenRouterAuthError,
    OpenRouterUnavailableError,
)
from services.doc_parser import extract_text_from_file, SUPPORTED_EXTENSIONS
from routers.auth import require_investor, get_current_investor, Investor

router = APIRouter(prefix="/api/v1/chat", tags=["chat"])

SYSTEM_PROMPT = (
    "You are TunisIA, an AI investment assistant specializing in the Tunisian market and "
    "comparable emerging economies (North Africa, West Africa, East Africa, MENA, South/Southeast Asia). "
    "You help investors analyze startups, understand sector trends, evaluate risk, and interpret "
    "financial metrics such as EBITDA margin, CAGR, TAM, debt-to-EBITDA, and ESG scores. "
    "You are concise, factual, and investment-focused. When you don't have specific data, say so "
    "and suggest what due-diligence steps the investor should take. "
    "Respond in the same language the user writes in."
)


# ── Schemas ───────────────────────────────────────────────────────────────────

class Message(BaseModel):
    role: str   # "user" or "assistant"
    content: str
    provider: Optional[str] = "local"   # "local" (Ollama) | "openrouter"
    web_search: Optional[bool] = False
    include_portfolio: Optional[bool] = False
    include_memory: Optional[bool] = False


class ChatRequest(BaseModel):
    messages: List[Message]
    provider: Optional[str] = "local"
    web_search: Optional[bool] = False
    include_portfolio: Optional[bool] = False
    include_memory: Optional[bool] = False


class ExportPdfRequest(BaseModel):
    content: str
    title: Optional[str] = None


# ── Provider dispatch ─────────────────────────────────────────────────────────

def _last_user_message(history: list) -> str:
    """The most recent user turn — used as the web-search query."""
    for m in reversed(history):
        if m.get("role") == "user" and m.get("content"):
            return m["content"]
    return ""


async def _web_search_suffix(web_search: bool, history: list) -> tuple[str, list]:
    """Run a free DuckDuckGo search+scrape and return (system-prompt addendum, sources).

    Best-effort: on no results / failure returns ("", []) so chat still answers
    from the model's own knowledge. Used for ALL providers (OpenRouter's native
    web tool isn't wired, so we ground the prompt ourselves).
    """
    if not web_search:
        return "", []
    query = _last_user_message(history)
    if not query:
        return "", []
    from services.web_search_service import get_web_context
    result = await get_web_context(query)
    if not result["context"]:
        return "", []
    suffix = (
        "\n\nThe following are live web search results retrieved just now for the "
        "user's question. Prefer these for any current/factual claim, and cite the "
        "relevant source number(s) inline like [1], [2]. If they don't cover the "
        "question, say so rather than guessing.\n\n" + result["context"]
    )
    return suffix, result["sources"]


def _sources_footer(sources: list) -> str:
    if not sources:
        return ""
    lines = "\n".join(f"[{s['n']}] {s['title']} — {s['url']}" for s in sources)
    return "\n\n---\nSources:\n" + lines


async def _generate_reply(
    provider: Optional[str],
    history: list,
    investor: Optional[Investor],
    web_search: bool = False,
    system_prompt_suffix: str = "",
) -> tuple[str, str]:
    """Route a chat completion to the chosen provider, normalizing errors to HTTP.

    Returns (reply, reasoning) — `reasoning` is the model's thinking trace
    (empty string when none was produced).
    """
    web_suffix, sources = await _web_search_suffix(web_search, history)
    system_prompt = SYSTEM_PROMPT + system_prompt_suffix + web_suffix
    if provider == "openrouter":
        key = getattr(investor, "openrouter_api_key", None) if investor else None
        if not key:
            raise HTTPException(400, detail={
                "error": "No OpenRouter key",
                "detail": "Add your OpenRouter API key in settings to use the cloud model.",
            })
        try:
            reply, reasoning = await openrouter_chat_with_history(key, system_prompt, history, web_search=False)
        except OpenRouterAuthError as e:
            raise HTTPException(400, detail={"error": "OpenRouter auth", "detail": str(e)})
        except OpenRouterUnavailableError as e:
            raise HTTPException(503, detail={"error": "OpenRouter unavailable", "detail": str(e)})
        return reply + _sources_footer(sources), reasoning

    # default: local Ollama
    try:
        reply, reasoning = await chat_with_history(system_prompt, history)
    except OllamaTimeoutError as e:
        raise HTTPException(503, detail={"error": "AI timeout", "detail": str(e)})
    except OllamaUnavailableError as e:
        raise HTTPException(503, detail={"error": "AI unavailable", "detail": str(e)})
    return reply + _sources_footer(sources), reasoning


def _portfolio_suffix(include_portfolio: bool, investor: Optional[Investor], db: Session) -> str:
    """Build the system-prompt addendum for the "Portfolio" context toggle."""
    if not include_portfolio or not investor:
        return ""
    from services.portfolio_context import build_portfolio_context
    return (
        "\n\nThe investor has enabled portfolio context. Use the following data about "
        "their tracked investments and to-do list to answer questions about their "
        "portfolio, investments, deadlines, or tasks:\n\n" + build_portfolio_context(investor, db)
    )


def _memory_suffix(
    include_memory: bool, provider: Optional[str], investor: Optional[Investor], db: Session
) -> str:
    """Build the system-prompt addendum for the "Memory" context toggle.

    Local Ollama only — never injected for the OpenRouter (cloud) provider.
    """
    if not include_memory or provider == "openrouter" or not investor:
        return ""
    from services.memory_context import build_memory_context
    ctx = build_memory_context(investor, db)
    if not ctx:
        return ""
    return (
        "\n\nThe investor has enabled persistent memory. Use these saved reference "
        "templates and context:\n\n" + ctx
    )


# ── Stateless endpoint (backward compat) ─────────────────────────────────────

@router.post("")
async def chat_endpoint(
    body: ChatRequest,
    request: Request,
    investor: Optional[Investor] = Depends(get_current_investor),
    db: Session = Depends(get_db),
):
    if not body.messages:
        raise HTTPException(400, detail={"error": "Bad request", "detail": "messages list is empty"})

    history = [{"role": m.role, "content": m.content} for m in body.messages]
    suffix = _portfolio_suffix(body.include_portfolio or False, investor, db)
    suffix += _memory_suffix(body.include_memory or False, body.provider, investor, db)
    reply, reasoning = await _generate_reply(body.provider, history, investor, web_search=body.web_search or False, system_prompt_suffix=suffix)
    return {"reply": reply, "reasoning": reasoning}


# ── Document upload → text (for feeding the assistant) ───────────────────────

@router.post("/extract-document")
async def extract_document(
    file: UploadFile = File(...),
    investor: Investor = Depends(require_investor),
):
    content = await file.read()
    try:
        text = extract_text_from_file(file.filename or "", content)
    except ValueError:
        raise HTTPException(400, detail={
            "error": "Unsupported file",
            "detail": f"Supported formats: {', '.join(SUPPORTED_EXTENSIONS)}",
        })
    return {"filename": file.filename, "text": text, "chars": len(text)}


# ── Export an assistant reply (markdown) as a PDF ────────────────────────────

@router.post("/export-pdf")
def export_pdf(
    body: ExportPdfRequest,
    investor: Investor = Depends(require_investor),
):
    """Render a chat reply (lightweight markdown) into a downloadable PDF.

    LLMs only emit text; this turns that text — e.g. a PV that already follows
    the investor's saved memory template — into a structured PDF, preserving
    headings, lists and bold.
    """
    if not body.content or not body.content.strip():
        raise HTTPException(400, detail={
            "error": "Empty content",
            "detail": "Nothing to export — the message is empty.",
        })
    pdf_bytes = markdown_to_pdf_bytes(body.content, title=body.title)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=document.pdf"},
    )


# ── Session helpers ───────────────────────────────────────────────────────────

def _session_out(session: ChatSession, message_count: int) -> dict:
    return {
        "id": session.id,
        "title": session.title,
        "created_at": session.created_at.isoformat() if session.created_at else None,
        "updated_at": session.updated_at.isoformat() if session.updated_at else None,
        "message_count": message_count,
    }


# ── Session endpoints ─────────────────────────────────────────────────────────

@router.post("/sessions")
def create_session(
    investor: Investor = Depends(require_investor),
    db: Session = Depends(get_db),
):
    session = ChatSession(investor_id=investor.id, title="New Chat")
    db.add(session)
    db.commit()
    db.refresh(session)
    return _session_out(session, 0)


@router.get("/sessions")
def list_sessions(
    investor: Investor = Depends(require_investor),
    db: Session = Depends(get_db),
):
    sessions = (
        db.query(ChatSession)
        .filter(ChatSession.investor_id == investor.id)
        .order_by(ChatSession.updated_at.desc())
        .all()
    )
    result = []
    for s in sessions:
        count = db.query(ChatMessageRecord).filter(ChatMessageRecord.session_id == s.id).count()
        result.append(_session_out(s, count))
    return {"sessions": result}


@router.get("/sessions/{session_id}")
def get_session(
    session_id: int,
    investor: Investor = Depends(require_investor),
    db: Session = Depends(get_db),
):
    session = (
        db.query(ChatSession)
        .filter(ChatSession.id == session_id, ChatSession.investor_id == investor.id)
        .first()
    )
    if not session:
        raise HTTPException(404, detail="Session not found")

    messages = (
        db.query(ChatMessageRecord)
        .filter(ChatMessageRecord.session_id == session_id)
        .order_by(ChatMessageRecord.created_at)
        .all()
    )
    return {
        "id": session.id,
        "title": session.title,
        "created_at": session.created_at.isoformat() if session.created_at else None,
        "messages": [{"role": m.role, "content": m.content} for m in messages],
    }


@router.post("/sessions/{session_id}/messages")
async def send_session_message(
    session_id: int,
    body: Message,
    request: Request,
    investor: Investor = Depends(require_investor),
    db: Session = Depends(get_db),
):
    session = (
        db.query(ChatSession)
        .filter(ChatSession.id == session_id, ChatSession.investor_id == investor.id)
        .first()
    )
    if not session:
        raise HTTPException(404, detail="Session not found")

    # Auto-title from first user message
    if session.title == "New Chat" and body.role == "user":
        session.title = body.content[:60] + ("..." if len(body.content) > 60 else "")

    user_record = ChatMessageRecord(session_id=session_id, role=body.role, content=body.content)
    db.add(user_record)
    db.commit()

    # Build full history for AI
    all_messages = (
        db.query(ChatMessageRecord)
        .filter(ChatMessageRecord.session_id == session_id)
        .order_by(ChatMessageRecord.created_at)
        .all()
    )
    history = [{"role": m.role, "content": m.content} for m in all_messages]

    suffix = _portfolio_suffix(body.include_portfolio or False, investor, db)
    suffix += _memory_suffix(body.include_memory or False, body.provider, investor, db)
    reply, reasoning = await _generate_reply(body.provider, history, investor, web_search=body.web_search or False, system_prompt_suffix=suffix)

    assistant_record = ChatMessageRecord(session_id=session_id, role="assistant", content=reply)
    db.add(assistant_record)
    session.updated_at = datetime.utcnow()
    db.commit()

    return {"reply": reply, "reasoning": reasoning, "session_id": session_id}


@router.delete("/sessions/{session_id}")
def delete_session(
    session_id: int,
    investor: Investor = Depends(require_investor),
    db: Session = Depends(get_db),
):
    session = (
        db.query(ChatSession)
        .filter(ChatSession.id == session_id, ChatSession.investor_id == investor.id)
        .first()
    )
    if not session:
        raise HTTPException(404, detail="Session not found")

    db.query(ChatMessageRecord).filter(ChatMessageRecord.session_id == session_id).delete()
    db.delete(session)
    db.commit()
    return {"ok": True}
