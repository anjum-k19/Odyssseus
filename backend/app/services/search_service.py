"""Web search via Serper (Google Search API). Used by Chorus for real article links."""
import logging
import httpx

from app.config import get_config

logger = logging.getLogger(__name__)
SERPER_URL = "https://google.serper.dev/search"


def search(query: str, num: int = 5) -> list[dict]:
    """
    Run a web search. Returns list of {"title", "link", "snippet"}.
    Returns [] if SERPER_API_KEY is missing or request fails.
    """
    cfg = get_config()
    api_key = (cfg.get("serper_api_key") or "").strip()
    if not api_key:
        logger.debug("search skipped: no SERPER_API_KEY")
        return []
    query = (query or "").strip()
    if not query:
        return []
    try:
        with httpx.Client(timeout=15.0) as client:
            r = client.post(
                SERPER_URL,
                json={"q": query, "num": min(num, 10)},
                headers={"X-API-KEY": api_key, "Content-Type": "application/json"},
            )
            r.raise_for_status()
            data = r.json()
    except Exception as e:
        logger.warning("search failed query=%r: %s", query[:60], e)
        return []
    organic = data.get("organic") or []
    out = []
    for item in organic:
        link = (item.get("link") or "").strip()
        if not link or link.startswith("http://localhost") or "example.com" in link:
            continue
        out.append({
            "title": (item.get("title") or link)[:200],
            "link": link,
            "snippet": (item.get("snippet") or "")[:300],
        })
    return out[:num]
