"""Ariadne: link graph / provenance."""
import logging
from urllib.parse import urlparse
from fastapi import APIRouter, HTTPException

from app.models import AriadneRequest, AriadneResponse, AriadneNode, AriadneEdge
from app.services.url_normalizer import normalize_url
from app.services.valkey_client import get_ariadne, set_ariadne
from app.services.gemini_service import classify_links

router = APIRouter()
logger = logging.getLogger(__name__)


def _domain(url: str) -> str:
    try:
        return urlparse(url or "").netloc or url or ""
    except Exception:
        return url or ""


@router.post("/ariadne", response_model=AriadneResponse)
def ariadne(req: AriadneRequest):
    """Build link graph: classify links, return nodes + edges; cache by normalized URL."""
    logger.info("ariadne received url=%r links_count=%s", req.url[:80] if req.url else "", len(req.links or []))
    normalized = normalize_url(req.url)
    if not normalized:
        logger.warning("ariadne invalid URL -> 400")
        raise HTTPException(status_code=400, detail="Invalid URL")
    links = [u for u in (req.links or []) if u and u.strip()][:50]
    logger.info("ariadne normalized=%r links_after_filter=%s", normalized[:80], len(links))
    cached = get_ariadne(normalized)
    if cached and cached.get("links_count") == len(links):
        logger.info("ariadne CACHE HIT nodes=%s edges=%s", len(cached.get("nodes", [])), len(cached.get("edges", [])))
        return AriadneResponse(
            normalized_url=normalized,
            nodes=[AriadneNode(**n) for n in cached.get("nodes", [])],
            edges=[AriadneEdge(**e) for e in cached.get("edges", [])],
            alerts=cached.get("alerts", []),
            from_cache=True,
        )
    logger.info("ariadne CACHE MISS calling classify_links")
    classified = classify_links(req.url, links)
    nodes = [AriadneNode(id=normalized, label=_domain(normalized), type="page")]
    for c in classified:
        nodes.append(
            AriadneNode(id=c["url"], label=c.get("label", c["url"]), type=c.get("type", "unknown"))
        )
    edges = [AriadneEdge(source=normalized, target=c["url"]) for c in classified]
    alerts = []
    for c in classified:
        if c.get("type") == "broken":
            alerts.append(f"Broken link: {c['url']}")
    graph = {
        "nodes": [n.model_dump() for n in nodes],
        "edges": [e.model_dump() for e in edges],
        "alerts": alerts,
        "links_count": len(links),
    }
    set_ariadne(normalized, graph)
    logger.info("ariadne built graph nodes=%s edges=%s alerts=%s", len(nodes), len(edges), len(alerts))
    return AriadneResponse(
        normalized_url=normalized,
        nodes=nodes,
        edges=edges,
        alerts=alerts,
        from_cache=False,
    )
