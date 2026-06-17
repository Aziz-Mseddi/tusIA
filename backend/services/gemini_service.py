"""
Google Gemini client — the cloud LLM alternative to the local Ollama path.

Mirrors the surface of `ollama_service` (chat_with_history) so the chat router
can swap providers cleanly. The API key is supplied per request (each investor
stores their own key), so functions take `api_key` as the first argument.
"""
import os

MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")


class GeminiAuthError(Exception):
    """Bad / missing / unauthorized API key — surfaces to the user as a 400."""
    pass


class GeminiUnavailableError(Exception):
    """Network problem, rate limit, or other transient failure — a 503."""
    pass


def _to_gemini_contents(messages: list) -> list:
    """Map our {role: user|assistant, content} history to Gemini's contents.

    Gemini uses the role name "model" for assistant turns.
    """
    contents = []
    for m in messages:
        role = "model" if m.get("role") == "assistant" else "user"
        contents.append({"role": role, "parts": [{"text": m.get("content", "")}]})
    return contents


async def chat_with_history(
    api_key: str, system_prompt: str, messages: list, web_search: bool = False
) -> str:
    if not api_key:
        raise GeminiAuthError("No Gemini API key configured.")

    try:
        from google import genai
        from google.genai import types
    except ImportError as exc:  # pragma: no cover - dependency guard
        raise GeminiUnavailableError(
            "google-genai is not installed. Run: pip install google-genai"
        ) from exc

    client = genai.Client(api_key=api_key)
    tools = [types.Tool(google_search=types.GoogleSearch())] if web_search else None
    try:
        response = await client.aio.models.generate_content(
            model=MODEL,
            contents=_to_gemini_contents(messages),
            config=types.GenerateContentConfig(
                system_instruction=system_prompt,
                tools=tools,
            ),
        )
    except Exception as exc:  # noqa: BLE001 - normalize SDK errors to our two types
        status = getattr(exc, "status_code", None) or getattr(exc, "code", None)
        msg = str(exc).lower()
        if status in (400, 401, 403) or any(
            k in msg for k in ("api key", "api_key", "permission", "unauthorized", "invalid")
        ):
            raise GeminiAuthError(
                "Gemini rejected the request — check that your API key is valid."
            ) from exc
        raise GeminiUnavailableError(f"Gemini request failed: {exc}") from exc

    text = getattr(response, "text", None)
    if not text:
        raise GeminiUnavailableError("Gemini returned an empty response.")
    return text
