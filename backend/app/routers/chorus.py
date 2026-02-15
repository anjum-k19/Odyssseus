"""Chorus: alternative perspectives."""
import logging
from fastapi import APIRouter

from app.models import ChorusRequest, ChorusResponse, ChorusLink
from app.services.gemini_service import chorus_alternatives

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/chorus", response_model=ChorusResponse)
def chorus(req: ChorusRequest):
    """Suggest alternative viewpoints on the same topic."""
    topic = (req.topic_or_summary or "").strip() or req.url
    logger.info("chorus received url=%r topic_len=%s topic_preview=%r", req.url[:80] if req.url else "", len(topic), topic[:60] + ("..." if len(topic) > 60 else ""))
    items = chorus_alternatives(topic)
    logger.info("chorus alternatives_count=%s labels=%s", len(items), [x.get("label") for x in items])
    return ChorusResponse(
        alternatives=[ChorusLink(label=x["label"], url=x["url"], perspective=x.get("perspective", "")) for x in items]
    )
