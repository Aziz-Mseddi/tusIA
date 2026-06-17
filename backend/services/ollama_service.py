import httpx
import json
import logging
import re
import os

OLLAMA_BASE = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
MODEL       = os.getenv("OLLAMA_MODEL", "qwen3.6")

# Ollama's runtime default context window (2k-4k tokens) is far smaller than
# qwen3.6's 256k max. A few pages of pitch-deck/contract text plus a long
# system prompt can silently exceed that default — Ollama truncates the
# context with no error, which looks like the model "ignoring" most of the
# document. Always request a generous context window explicitly.
OLLAMA_NUM_CTX = int(os.getenv("OLLAMA_NUM_CTX", "16384"))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("ollama_service")


class OllamaTimeoutError(Exception):
    pass

class OllamaUnavailableError(Exception):
    pass


def _format_http_error(e: httpx.HTTPStatusError) -> str:
    """Surface Ollama's real error body (e.g. 'model requires more system
    memory than is available') instead of a bare 500, so an oversized or
    misconfigured model is immediately obvious in logs and API responses."""
    try:
        detail = e.response.json().get("error", "") or e.response.text
    except Exception:
        detail = e.response.text
    return f"Ollama request failed ({e.response.status_code}): {detail[:300] or 'no detail'}"


def _ollama_client():
    return httpx.AsyncClient(timeout=httpx.Timeout(connect=5.0, read=1000.0, write=10.0, pool=5.0))


_THINK_RE = re.compile(r"<think>(.*?)</think>", re.DOTALL | re.IGNORECASE)


def split_reasoning(content: str) -> tuple[str, str]:
    """Separate <think>…</think> chain-of-thought from the final answer.

    Returns (answer, reasoning). Thinking models (qwen3, deepseek-r1, …) wrap
    their reasoning in <think> tags inline. Handles a truncated/unclosed
    <think> by treating the tail as reasoning.
    """
    if not content:
        return "", ""
    blocks = _THINK_RE.findall(content)
    reasoning = "\n\n".join(b.strip() for b in blocks).strip()
    answer = _THINK_RE.sub("", content).strip()
    if not answer and "<think>" in content.lower():
        reasoning = content.split("<think>", 1)[-1].replace("</think>", "").strip()
    return answer, reasoning


async def chat_with_history(system_prompt: str, messages: list) -> tuple[str, str]:
    """Return (answer, reasoning). `reasoning` is the model's thinking trace
    (empty string when the model emits none)."""
    try:
        async with _ollama_client() as client:
            response = await client.post(f"{OLLAMA_BASE}/api/chat", json={
                "model": MODEL,
                "stream": False,
                "think": True,  # ask thinking models to expose their reasoning trace
                "messages": [{"role": "system", "content": system_prompt}] + messages,
                "options": {"num_ctx": OLLAMA_NUM_CTX},
            })
            response.raise_for_status()
            msg = response.json().get("message", {}) or {}
            content = msg.get("content", "") or ""
            # Newer Ollama returns the trace in a dedicated `thinking` field;
            # older builds inline it as <think>…</think> inside content.
            reasoning = (msg.get("thinking") or "").strip()
            answer, parsed = split_reasoning(content)
            if not reasoning:
                reasoning = parsed
            return (answer or content), reasoning
    except httpx.ReadTimeout:
        raise OllamaTimeoutError("Ollama did not respond in time. The model may be loading — try again in a moment.")
    except (httpx.ConnectError, httpx.ConnectTimeout):
        raise OllamaUnavailableError("Cannot reach Ollama. Make sure it is running: ollama serve")
    except httpx.HTTPStatusError as e:
        raise OllamaUnavailableError(_format_http_error(e))


async def chat(
    system_prompt: str,
    user_message: str,
    json_mode: bool = False,
    temperature: float | None = None,
    think: bool | None = None,
) -> str:
    payload = {
        "model": MODEL,
        "stream": False,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": user_message},
        ],
    }
    if json_mode:
        payload["format"] = "json"
    options: dict = {"num_ctx": OLLAMA_NUM_CTX}
    if temperature is not None:
        options["temperature"] = temperature
    payload["options"] = options
    if think is not None:
        # qwen3 / thinking models: disable chain-of-thought for fast, clean output.
        # Ollama ignores this field for models that don't support it.
        payload["think"] = think

    logger.info(
        "Ollama request: model=%s json_mode=%s think=%s temperature=%s "
        "system_chars=%d user_chars=%d num_ctx=%d | system_preview=%r | user_preview=%r",
        MODEL, json_mode, think, temperature,
        len(system_prompt), len(user_message), OLLAMA_NUM_CTX,
        system_prompt[:200], user_message[:300],
    )

    try:
        async with _ollama_client() as client:
            response = await client.post(f"{OLLAMA_BASE}/api/chat", json=payload)
            response.raise_for_status()
            content = response.json()["message"]["content"]
            logger.info("Ollama response (%d chars): %r", len(content), content[:500])
            return content
    except httpx.ReadTimeout:
        raise OllamaTimeoutError("Ollama did not respond in time.")
    except (httpx.ConnectError, httpx.ConnectTimeout):
        raise OllamaUnavailableError("Cannot reach Ollama.")
    except httpx.HTTPStatusError as e:
        raise OllamaUnavailableError(_format_http_error(e))


def _extract_json_from_text(raw: str) -> dict | list:
    """
    Try to parse raw as JSON. If it's wrapped in prose, pull out the first
    {...} or [...] block with a regex before giving up.
    """
    cleaned = (
        raw.strip()
        .removeprefix("```json")
        .removeprefix("```")
        .removesuffix("```")
        .strip()
    )
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    # Regex fallback: grab the first complete JSON object or array
    m = re.search(r'(\{[\s\S]*\}|\[[\s\S]*\])', cleaned)
    if m:
        return json.loads(m.group(1))

    raise json.JSONDecodeError("No JSON found", cleaned, 0)


async def extract_json(
    system_prompt: str,
    user_message: str,
    retries: int = 2,
    temperature: float | None = None,
    think: bool | None = None,
) -> dict:
    strict_suffix = "\n\nReturn ONLY valid JSON. No markdown fences. No preamble. No explanation."
    for attempt in range(retries):
        raw = await chat(
            system_prompt + (strict_suffix if attempt > 0 else ""),
            user_message,
            json_mode=True,
            temperature=temperature,
            think=think,
        )
        try:
            return _extract_json_from_text(raw)
        except (json.JSONDecodeError, ValueError):
            logger.warning(
                "extract_json: attempt %d/%d returned non-JSON: %r",
                attempt + 1, retries, raw[:300],
            )
            if attempt == retries - 1:
                raise ValueError(
                    f"Ollama returned non-JSON after {retries} attempts: {raw[:200]}"
                )


async def check_ollama_health() -> bool:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(f"{OLLAMA_BASE}/api/tags")
            return r.status_code == 200
    except Exception:
        return False
