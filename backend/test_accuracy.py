"""
OpenRouter information-accuracy harness.

Runs a fixed set of factual questions through the OpenRouter chat path TWICE:
  - baseline      : model only, no web grounding
  - web-grounded  : same model + our free DuckDuckGo search/scrape context

Each question has `expect` = substrings that MUST appear for the answer to count
as correct (case-insensitive; a tuple means "any one of these is acceptable").
Time-sensitive / specific-fact questions are chosen so the difference between
"model guessing from weights" and "model reading the live web" is visible.

Run:
  myvenvv\Scripts\python.exe backend\test_accuracy.py YOUR_OPENROUTER_KEY
  # or set OPENROUTER_API_KEY / OPENROUTER_MODEL env vars
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from services.openrouter_service import chat_with_history, MODEL
from services.web_search_service import get_web_context

SYSTEM = (
    "You are a precise factual assistant. Answer in one or two sentences. "
    "If you are unsure, say you are unsure rather than guessing."
)

# (question, expected-substring-or-tuple-of-acceptable-substrings)
CASES = [
    ("What is the capital city of Tunisia?", "tunis"),
    ("What currency does Tunisia use? Give the 3-letter ISO code.", "tnd"),
    ("Who is the current President of the United States in 2026?", ("trump", "vance")),
    ("What was the closing level of the S&P 500 index on its most recent trading day?",
     ("5", "6")),  # weak check — mainly judged by hand
    ("Which company makes the Claude family of AI models?", "anthropic"),
]


def _hit(answer: str, expect) -> bool:
    a = answer.lower()
    if isinstance(expect, tuple):
        return any(e.lower() in a for e in expect)
    return expect.lower() in a


async def _ask(key: str, question: str, web: bool) -> str:
    history = [{"role": "user", "content": question}]
    system = SYSTEM
    if web:
        ctx = await get_web_context(question)
        if ctx["context"]:
            system += (
                "\n\nLive web results (prefer for current facts, cite [n]):\n"
                + ctx["context"]
            )
    answer, _reasoning = await chat_with_history(key, system, history)
    return answer


async def main() -> None:
    key = (sys.argv[1] if len(sys.argv) > 1 else os.getenv("OPENROUTER_API_KEY", "")).strip()
    if not key:
        print("ERROR: pass an OpenRouter API key as arg 1 or set OPENROUTER_API_KEY")
        sys.exit(1)

    print(f"Model: {MODEL}\n" + "=" * 70)
    base_score = web_score = 0
    for q, expect in CASES:
        print(f"\nQ: {q}")
        try:
            base = await _ask(key, q, web=False)
        except Exception as exc:  # noqa: BLE001
            base = f"<error: {exc}>"
        try:
            grounded = await _ask(key, q, web=True)
        except Exception as exc:  # noqa: BLE001
            grounded = f"<error: {exc}>"

        b_ok = _hit(base, expect)
        w_ok = _hit(grounded, expect)
        base_score += b_ok
        web_score += w_ok
        print(f"  [baseline {'PASS' if b_ok else 'FAIL'}] {base.strip()[:300]}")
        print(f"  [web      {'PASS' if w_ok else 'FAIL'}] {grounded.strip()[:300]}")

    n = len(CASES)
    print("\n" + "=" * 70)
    print(f"baseline (no web): {base_score}/{n}")
    print(f"web-grounded     : {web_score}/{n}")


if __name__ == "__main__":
    asyncio.run(main())
