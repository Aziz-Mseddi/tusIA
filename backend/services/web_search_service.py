"""
Free web search + scrape — gives the chat assistant live web grounding without
any paid search API.

Pipeline:
  1. DuckDuckGo text search via `ddgs` (no API key, free) → top result URLs.
  2. Fetch each page with httpx and extract the main article text with
     trafilatura (falls back to a crude tag strip if extraction is empty).
  3. Return a compact, numbered context block + a source list the chat router
     injects into the model's system prompt so it can answer from — and cite —
     current web content.

Everything is best-effort: any failure (no network, blocked page, parse error)
degrades to fewer/no sources rather than raising, so chat never breaks because
the web step failed. The sync core runs in a worker thread via
`get_web_context()` so it doesn't block the async event loop.
"""
from __future__ import annotations

import asyncio
import logging

import httpx

logger = logging.getLogger("web_search_service")

# Per-page + per-query budgets. Kept small so a slow page can't stall a chat
# turn, and so the combined context stays well under the model's window.
MAX_RESULTS = 4
MAX_CHARS_PER_PAGE = 2000
MAX_TOTAL_CHARS = 7000
FETCH_TIMEOUT = 8.0

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    )
}


def _ddg_search(query: str, max_results: int) -> list[dict]:
    """Return [{title, url, snippet}] from DuckDuckGo. Empty list on any failure."""
    try:
        from ddgs import DDGS
    except ImportError:
        logger.warning("ddgs not installed — web search disabled")
        return []
    try:
        with DDGS() as ddgs:
            hits = ddgs.text(query, max_results=max_results) or []
    except Exception as exc:  # noqa: BLE001 — search is best-effort
        logger.warning("DuckDuckGo search failed: %s", exc)
        return []

    out = []
    for h in hits:
        url = h.get("href") or h.get("url") or h.get("link")
        if url:
            out.append({
                "title": (h.get("title") or "").strip(),
                "url": url,
                "snippet": (h.get("body") or "").strip(),
            })
    return out


def _extract_text(html: str, url: str) -> str:
    """Main-content text from raw HTML; empty string if nothing usable."""
    try:
        import trafilatura
        text = trafilatura.extract(
            html, include_comments=False, include_tables=False, url=url
        )
        if text:
            return text
    except Exception as exc:  # noqa: BLE001
        logger.debug("trafilatura failed for %s: %s", url, exc)

    # Fallback: strip tags with BeautifulSoup.
    try:
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(html, "html.parser")
        for tag in soup(["script", "style", "noscript", "header", "footer", "nav"]):
            tag.decompose()
        return " ".join(soup.get_text(" ").split())
    except Exception:  # noqa: BLE001
        return ""


def _fetch(url: str) -> str:
    try:
        with httpx.Client(
            timeout=FETCH_TIMEOUT, headers=_HEADERS, follow_redirects=True
        ) as client:
            r = client.get(url)
            r.raise_for_status()
            ctype = r.headers.get("content-type", "")
            if "html" not in ctype and "text" not in ctype:
                return ""
            return r.text
    except Exception as exc:  # noqa: BLE001
        logger.debug("fetch failed for %s: %s", url, exc)
        return ""


def search_and_scrape(query: str, max_results: int = MAX_RESULTS) -> dict:
    """
    Synchronous core. Returns:
      {"context": "<numbered text block or ''>", "sources": [{"n","title","url"}]}
    Never raises — on total failure returns empty context + sources.
    """
    query = (query or "").strip()
    if not query:
        return {"context": "", "sources": []}

    hits = _ddg_search(query, max_results)
    blocks: list[str] = []
    sources: list[dict] = []
    total = 0
    n = 0
    for hit in hits:
        html = _fetch(hit["url"])
        text = _extract_text(html, hit["url"]) if html else ""
        # Fall back to the search snippet when the page can't be scraped, so the
        # source still contributes something rather than being dropped.
        body = text or hit["snippet"]
        if not body:
            continue
        n += 1
        remaining = MAX_TOTAL_CHARS - total
        if remaining <= 0:
            break
        body = body[: min(MAX_CHARS_PER_PAGE, remaining)].strip()
        title = hit["title"] or hit["url"]
        blocks.append(f"[{n}] {title} ({hit['url']})\n{body}")
        sources.append({"n": n, "title": title, "url": hit["url"]})
        total += len(body)

    return {"context": "\n\n".join(blocks), "sources": sources}


async def get_web_context(query: str, max_results: int = MAX_RESULTS) -> dict:
    """Async wrapper — runs the blocking search/scrape in a worker thread."""
    return await asyncio.to_thread(search_and_scrape, query, max_results)
