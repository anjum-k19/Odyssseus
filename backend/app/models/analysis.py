"""Pydantic schemas for page analysis."""
from typing import Any

from pydantic import BaseModel, Field


class PageContent(BaseModel):
    """Stored page content (text + media refs)."""
    text: str = ""
    media: list[str] = Field(default_factory=list)


class TextMetrics(BaseModel):
    """Scores from Gemini (humanity, integrity, rhetoric)."""
    humanity: float = 0.0
    integrity: float = 0.0
    rhetoric: float = 0.0


class MediaMetrics(BaseModel):
    """Placeholder for future Twelve Labs / image results."""
    extra: dict[str, Any] = Field(default_factory=dict)


class AnalyzeRequest(BaseModel):
    """Request body for POST /analyze."""
    url: str
    text: str = ""
    media: list[str] = Field(default_factory=list)


class AnalyzeResponse(BaseModel):
    """Response for POST /analyze."""
    normalized_url: str
    text_metrics: TextMetrics
    media_metrics: MediaMetrics
    from_cache: bool = False
    neutral_headline: str = ""  # Hype-Filter: rewritten headline
    # Excerpts that most contributed to low scores (metric name -> list of exact quotes from page text)
    contributing_excerpts: dict[str, list[str]] = Field(default_factory=dict)


class LitmusRequest(BaseModel):
    """Request body for POST /litmus."""
    claim: str
    page_url: str = ""
    context: str = ""


class LitmusResponse(BaseModel):
    """Response for POST /litmus."""
    verdict: str  # "true" | "false" | "missing_context"
    explanation: str = ""
    from_cache: bool = False


class AriadneRequest(BaseModel):
    """Request body for POST /ariadne."""
    url: str
    links: list[str] = Field(default_factory=list)


class AriadneNode(BaseModel):
    id: str
    label: str
    type: str = "unknown"  # original_source | same_network | unknown | broken


class AriadneEdge(BaseModel):
    source: str
    target: str


class AriadneResponse(BaseModel):
    """Response for POST /ariadne."""
    normalized_url: str
    nodes: list[AriadneNode]
    edges: list[AriadneEdge]
    alerts: list[str] = Field(default_factory=list)
    from_cache: bool = False


class ChatRequest(BaseModel):
    """Request body for POST /chat (Oracle)."""
    page_text: str = ""
    message: str
    session_id: str = ""


class ChatResponse(BaseModel):
    """Response for POST /chat."""
    reply: str
    from_cache: bool = False


class ChorusRequest(BaseModel):
    """Request body for POST /chorus."""
    url: str
    topic_or_summary: str = ""


class ChorusLink(BaseModel):
    label: str
    url: str
    perspective: str = ""  # e.g. "neutral", "left", "right"


class ChorusResponse(BaseModel):
    """Response for POST /chorus."""
    alternatives: list[ChorusLink] = Field(default_factory=list)
