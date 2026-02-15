"""Normalize URLs for use as persistent storage keys."""
import logging
from urllib.parse import urlparse, urlunparse

logger = logging.getLogger(__name__)


def normalize_url(url: str) -> str:
    """
    Strip unnecessary parts and normalize for use as canonical key.
    - Remove fragment (#...)
    - Optional: strip or sort query params (we strip for stability)
    - Lowercase host
    - Path: strip trailing slash unless path is /
    """
    if not url or not url.strip():
        logger.debug("normalize_url empty input -> ''")
        return ""
    raw = url.strip()
    parsed = urlparse(raw)
    # Normalize scheme (default https)
    scheme = (parsed.scheme or "https").lower()
    if scheme not in ("http", "https"):
        scheme = "https"
    # Lowercase netloc (host)
    netloc = (parsed.netloc or "").lower()
    # Path: strip trailing slash except for /
    path = parsed.path or "/"
    if len(path) > 1 and path.endswith("/"):
        path = path.rstrip("/")
    # No fragment; no query (for stable key—same page same key)
    query = ""
    fragment = ""
    result = urlunparse((scheme, netloc, path, parsed.params, query, fragment))
    logger.info(
        "url_normalize input=%r scheme=%s netloc=%s path=%s -> normalized=%r",
        raw[:200] + ("..." if len(raw) > 200 else ""),
        scheme,
        netloc,
        path,
        result[:200] + ("..." if len(result) > 200 else ""),
    )
    return result
