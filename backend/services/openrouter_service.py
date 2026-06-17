"""
OpenRouter client — the cloud LLM alternative to the local Ollama path.

Mirrors the surface of `ollama_service` (chat_with_history) so the chat router
can swap providers cleanly. The API key is supplied per request (each investor
stores their own key), so functions take `api_key` as the first argument.

OpenRouter exposes an OpenAI-compatible REST API, so we talk to it directly
with httpx rather than pulling in another SDK. Model + host are configurable
via the OPENROUTER_MODEL / OPENROUTER_BASE_URL env vars. Model ids are in
"provider/model" form (e.g. "deepseek/deepseek-chat", "openai/gpt-4o-mini") —
see https://openrouter.ai/models for the full catalog.
"""
import asyncio
import os

import httpx

from services.ollama_service import split_reasoning as _split_reasoning

MODEL = os.getenv("OPENROUTER_MODEL", "nvidia/nemotron-3-ultra-550b-a55b:free")
BASE_URL = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
TIMEOUT = float(os.getenv("OPENROUTER_TIMEOUT", "60"))
# Free models frequently return a transient upstream error (often HTTP 200 with
# an {"error": {"code": 5xx}} body). Retry a few times before giving up.
MAX_RETRIES = int(os.getenv("OPENROUTER_RETRIES", "3"))


class OpenRouterAuthError(Exception):
    """Bad / missing / unauthorized API key — surfaces to the user as a 400."""
    pass


class OpenRouterUnavailableError(Exception):
    """Network problem, rate limit, or other transient failure — a 503."""
    pass


def _to_openai_messages(system_prompt: str, messages: list) -> list:
    """Map our {role: user|assistant, content} history to OpenAI-style messages,
    prepending the system instruction."""
    out = [{"role": "system", "content": system_prompt}]
    for m in messages:
        role = "assistant" if m.get("role") == "assistant" else "user"
        out.append({"role": role, "content": m.get("content", "")})
    return out


async def chat_with_history(
    api_key: str, system_prompt: str, messages: list, web_search: bool = False
) -> tuple[str, str]:
    """Retry transient OpenRouter failures (timeouts, 5xx, 200-with-error-body).

    Returns (answer, reasoning). Auth errors are not retried. `web_search` is
    accepted for signature parity with the other providers; OpenRouter's native
    web tool isn't wired up here.
    """
    last_exc: Exception | None = None
    for attempt in range(MAX_RETRIES):
        try:
            return await _single_completion(api_key, system_prompt, messages)
        except OpenRouterUnavailableError as exc:
            last_exc = exc
            if attempt < MAX_RETRIES - 1:
                await asyncio.sleep(1.5 * (attempt + 1))  # linear backoff
    raise last_exc  # type: ignore[misc]


async def _single_completion(api_key: str, system_prompt: str, messages: list) -> tuple[str, str]:
    if not api_key:
        raise OpenRouterAuthError("No OpenRouter API key configured.")

    payload = {
        "model": MODEL,
        "messages": _to_openai_messages(system_prompt, messages),
        "stream": False,
        # Ask reasoning-capable models to expose their thinking trace. Unified
        # param — silently ignored by models that don't support reasoning.
        "reasoning": {"enabled": True},
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            response = await client.post(
                f"{BASE_URL}/chat/completions", json=payload, headers=headers
            )
    except httpx.HTTPError as exc:  # network / timeout
        raise OpenRouterUnavailableError(f"OpenRouter request failed: {exc}") from exc

    if response.status_code in (401, 403):
        raise OpenRouterAuthError(
            "OpenRouter rejected the request — check that your API key is valid."
        )
    if response.status_code == 402:
        raise OpenRouterUnavailableError(
            "OpenRouter account has insufficient credits — top up to continue."
        )
    if response.status_code >= 400:
        # Bad request often means an invalid model id or malformed payload.
        detail = ""
        try:
            detail = response.json().get("error", {}).get("message", "")
        except Exception:  # noqa: BLE001
            detail = response.text[:200]
        if response.status_code == 400 and "model" in detail.lower():
            raise OpenRouterUnavailableError(
                f"OpenRouter model '{MODEL}' was rejected: {detail}. "
                "Set OPENROUTER_MODEL to a valid id (e.g. openai/gpt-oss-120b:free)."
            )
        raise OpenRouterUnavailableError(f"OpenRouter error {response.status_code}: {detail}")

    try:
        data = response.json()
    except ValueError as exc:
        raise OpenRouterUnavailableError("OpenRouter returned a non-JSON response.") from exc

    # OpenRouter can return HTTP 200 with an {"error": {...}} body when the
    # upstream provider fails (e.g. code 504 "Provider returned error"). Treat
    # that as a transient failure so the retry loop can recover.
    if isinstance(data, dict) and data.get("error") and not data.get("choices"):
        err = data["error"]
        msg = err.get("message", "") if isinstance(err, dict) else str(err)
        code = err.get("code", "") if isinstance(err, dict) else ""
        raise OpenRouterUnavailableError(
            f"OpenRouter provider error ({code}): {msg or 'no detail'}"
        )

    try:
        message = data["choices"][0]["message"]
        text = message.get("content")
    except (KeyError, IndexError, TypeError) as exc:
        raise OpenRouterUnavailableError("OpenRouter returned an unexpected response.") from exc

    if not text:
        raise OpenRouterUnavailableError("OpenRouter returned an empty response.")

    # Reasoning trace: OpenRouter normalizes it to `reasoning` (some providers
    # use `reasoning_content`); thinking models may also inline <think>…</think>.
    reasoning = (message.get("reasoning") or message.get("reasoning_content") or "").strip()
    answer, parsed = _split_reasoning(text)
    if not reasoning:
        reasoning = parsed
    return (answer or text), reasoning
