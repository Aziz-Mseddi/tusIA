import json
import os
from datetime import date

from models import ContractClause, Investment, Investor
from services.ollama_service import OllamaTimeoutError, OllamaUnavailableError, chat

_TEMPLATE_PATH = os.path.join(os.path.dirname(__file__), "..", "templates", "exercise_letter_template.md")

_RIGHT_TYPE_LABELS = {
    "put_option": "Put Option",
    "drag_along": "Drag-Along Right",
    "tag_along": "Tag-Along Right",
    "ratchet": "Ratchet (Anti-Dilution) Right",
}


def _load_template() -> str:
    with open(_TEMPLATE_PATH, "r", encoding="utf-8") as f:
        return f.read()


def _format_numbers(numbers: dict | None) -> str:
    if not numbers:
        return "No specific price/share figures stated in the source clause."
    parts = []
    if numbers.get("price") is not None:
        parts.append(f"- Price per share: {numbers['price']}")
    if numbers.get("share_count") is not None:
        parts.append(f"- Number of shares: {numbers['share_count']}")
    if numbers.get("threshold") is not None:
        parts.append(f"- Threshold: {numbers['threshold']}")
    return "\n".join(parts) if parts else "No specific price/share figures stated in the source clause."


def _build_context(clause: ContractClause, investment: Investment, investor: Investor) -> dict:
    numbers = json.loads(clause.numbers_json) if clause.numbers_json else None
    return {
        "company_name": investment.startup_name,
        "clause_reference": f"Clause #{clause.id} ({clause.description[:80]})",
        "right_type": _RIGHT_TYPE_LABELS.get(clause.clause_type, clause.clause_type.replace("_", " ").title()),
        "trigger_details": clause.trigger_condition or "Not specified in the source document.",
        "numbers": _format_numbers(numbers),
        "deadline": clause.due_date or "Not specified",
        "signatory": investor.full_name or investor.email,
        "date": date.today().isoformat(),
    }


def _fallback_fill(context: dict) -> str:
    text = _load_template()
    for key, value in context.items():
        text = text.replace(f"{{{{{key}}}}}", str(value))
    return text


async def draft_exercise_letter(clause: ContractClause, investment: Investment, investor: Investor) -> dict:
    """
    Fill the exercise-letter template with this clause's stored details.
    Template-filling (not from-scratch generation) keeps format/tone
    consistent for IM review; falls back to deterministic placeholder
    substitution if Ollama is unavailable.
    """
    context = _build_context(clause, investment, investor)
    template = _load_template()

    system = (
        "You are a legal assistant drafting formal exercise-notice letters for "
        "an investment fund. You will be given a letter TEMPLATE containing "
        "placeholders in the form {{placeholder_name}}, and a set of DETAILS to "
        "fill those placeholders with. Fill in each placeholder using the "
        "supplied details, preserving the template's structure, wording, and "
        "tone exactly as written elsewhere. Return ONLY the completed letter "
        "text — no commentary, no markdown fences, no extra sections."
    )
    user_message = (
        f"TEMPLATE:\n{template}\n\n"
        f"DETAILS (JSON):\n{json.dumps(context, indent=2)}"
    )

    try:
        letter = (await chat(system, user_message, think=False)).strip()
        if not letter:
            raise ValueError("empty response from Ollama")
        return {"letter_markdown": letter, "source": "ollama"}
    except (OllamaTimeoutError, OllamaUnavailableError, ValueError):
        return {"letter_markdown": _fallback_fill(context), "source": "fallback"}
