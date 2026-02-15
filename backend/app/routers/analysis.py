"""Page analysis route: POST /analyze. Persistent storage by normalized URL; Gemini when needed."""
import hashlib
import logging
from fastapi import APIRouter, HTTPException

from app.models import AnalyzeRequest, AnalyzeResponse, TextMetrics, MediaMetrics
from app.services.url_normalizer import normalize_url
from app.services.valkey_client import get_page, set_page
from app.services.gemini_service import get_text_metrics, rewrite_headline
from app.services.twelve_labs_service import get_video_metrics

router = APIRouter()
logger = logging.getLogger(__name__)


def _first_video_url(media: list[str]) -> str | None:
    for u in media or []:
        u_lower = (u or "").lower()
        if "youtube" in u_lower or "youtu.be" in u_lower or "vimeo" in u_lower:
            return u
        if u_lower.endswith((".mp4", ".webm", ".mov")):
            return u
    return None


def _text_hash(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()


@router.post("/analyze", response_model=AnalyzeResponse)
def analyze(req: AnalyzeRequest):
    """Normalize URL; return stored metrics if content matches; else run Gemini, persist, return."""
    logger.info("analyze received url=%r text_len=%s media_count=%s", req.url[:120] if req.url else "", len(req.text or ""), len(req.media or []))
    normalized = normalize_url(req.url)
    if not normalized:
        logger.warning("analyze invalid URL -> 400")
        raise HTTPException(status_code=400, detail="Invalid URL")
    incoming_hash = _text_hash(req.text)
    logger.info("analyze text_hash=%s (first 16) normalized_url=%r", incoming_hash[:16], normalized[:100])
    record = get_page(normalized)
    if record:
        stored_hash = (record.get("content") or {}).get("text_hash")
        if stored_hash == incoming_hash:
            tm = record.get("text_metrics") or {}
            mm = record.get("media_metrics") or {}
            logger.info("analyze CACHE HIT normalized=%r returning text_metrics=%s", normalized[:80], tm)
            return AnalyzeResponse(
                normalized_url=normalized,
                text_metrics=TextMetrics(
                    humanity=tm.get("humanity", 0.0),
                    integrity=tm.get("integrity", 0.0),
                    rhetoric=tm.get("rhetoric", 0.0),
                ),
                media_metrics=MediaMetrics(extra=mm),
                from_cache=True,
                neutral_headline=record.get("neutral_headline", ""),
            )
        logger.info("analyze CACHE MISS (content changed) stored_hash=%s incoming_hash=%s", (stored_hash or "")[:16], incoming_hash[:16])
    else:
        logger.info("analyze CACHE MISS (no record) running deep analysis")
    text_metrics = get_text_metrics(req.text)
    logger.info("analyze text_metrics received humanity=%.1f integrity=%.1f rhetoric=%.1f", text_metrics.humanity, text_metrics.integrity, text_metrics.rhetoric)
    media_metrics_extra: dict = {}
    video_url = _first_video_url(req.media)
    if video_url:
        logger.info("analyze video_url present=%r calling get_video_metrics", video_url[:80])
        media_metrics_extra["video"] = get_video_metrics(video_url)
    headline = (req.text or "").split("\n")[0][:500] if req.text else ""
    neutral_headline = rewrite_headline(headline) if headline else ""
    logger.info("analyze headline_len=%s neutral_headline_len=%s", len(headline), len(neutral_headline))
    page_record = {
        "content": {
            "text": req.text,
            "media": req.media,
            "text_hash": incoming_hash,
        },
        "text_metrics": {
            "humanity": text_metrics.humanity,
            "integrity": text_metrics.integrity,
            "rhetoric": text_metrics.rhetoric,
        },
        "media_metrics": media_metrics_extra,
        "neutral_headline": neutral_headline,
    }
    set_page(normalized, page_record)
    logger.info("analyze persisted page_record keys=%s responding from_cache=False", list(page_record.keys()))
    return AnalyzeResponse(
        normalized_url=normalized,
        text_metrics=text_metrics,
        media_metrics=MediaMetrics(extra=media_metrics_extra),
        from_cache=False,
        neutral_headline=neutral_headline,
    )
