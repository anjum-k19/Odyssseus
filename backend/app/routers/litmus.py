"""Litmus Test: select-to-fact-check."""
import hashlib
import logging
from fastapi import APIRouter

from app.models import LitmusRequest, LitmusResponse
from app.services.valkey_client import get_litmus, set_litmus
from app.services.gemini_service import fact_check_claim

router = APIRouter()
logger = logging.getLogger(__name__)


def _claim_hash(claim: str) -> str:
    return hashlib.sha256((claim or "").strip().encode("utf-8")).hexdigest()


@router.post("/litmus", response_model=LitmusResponse)
def litmus(req: LitmusRequest):
    """Fact-check a claim; cache by claim hash."""
    claim = (req.claim or "").strip()
    logger.info("litmus received claim_len=%s claim_preview=%r page_url=%r context_len=%s", len(claim), claim[:60] + ("..." if len(claim) > 60 else ""), (req.page_url or "")[:80], len(req.context or ""))
    if not claim:
        logger.warning("litmus empty claim -> missing_context")
        return LitmusResponse(verdict="missing_context", explanation="No claim provided.")
    key = _claim_hash(claim)
    logger.info("litmus claim_hash=%s", key[:16])
    cached = get_litmus(key)
    if cached:
        logger.info("litmus CACHE HIT returning verdict=%s", cached.get("verdict"))
        return LitmusResponse(
            verdict=cached.get("verdict", "missing_context"),
            explanation=cached.get("explanation", ""),
            from_cache=True,
        )
    logger.info("litmus CACHE MISS calling fact_check_claim")
    verdict, explanation = fact_check_claim(claim, req.context)
    set_litmus(key, {"verdict": verdict, "explanation": explanation})
    logger.info("litmus responding verdict=%s explanation_len=%s", verdict, len(explanation or ""))
    return LitmusResponse(verdict=verdict, explanation=explanation, from_cache=False)
