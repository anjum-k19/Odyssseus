"""Twelve Labs video analysis: deepfake probability and summary. Stub when no API key."""
import logging
from app.config import get_config

logger = logging.getLogger(__name__)

# Twelve Labs uses index-then-analyze; for now we return placeholder when no key.
# See https://docs.twelvelabs.io/api-reference/analyze-videos/analyze


def get_video_metrics(video_url: str) -> dict:
    """
    Return { "deepfake_score": 0.0-1.0, "summary": "..." }.
    When TWELVE_LABS_API_KEY is set, could call Twelve Labs analyze API with a custom prompt.
    """
    cfg = get_config()
    has_key = bool(cfg.get("twelve_labs_api_key"))
    logger.info("twelve_labs get_video_metrics video_url=%r has_api_key=%s", (video_url or "")[:80], has_key)
    if not has_key:
        logger.info("twelve_labs returning placeholder (no API key)")
        return {"deepfake_score": 0.0, "summary": ""}
    # TODO: index video by URL then call POST /v1.3/analyze with prompt for deepfake + summary
    out = {"deepfake_score": 0.0, "summary": ""}
    logger.info("twelve_labs returning stub payload=%s", out)
    return out
