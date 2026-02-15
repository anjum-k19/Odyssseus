"""Gemini service using the official Google Gen AI SDK (google-genai). Configurable model via config."""
import logging
import re

from app.config import get_config
from app.models import TextMetrics
from google import genai

logger = logging.getLogger(__name__)


def _get_client():
    """Build Gemini client from config. Returns None if api_key missing or SDK not installed."""
    if genai is None:
        return None
    cfg = get_config()
    api_key = (cfg.get("gemini_api_key") or "").strip()
    if not api_key:
        return None
    return genai.Client(api_key=api_key)


def _generate(model_name: str, contents: str) -> str | None:
    """Call Gemini generate_content; return response text or None."""
    client = _get_client()
    if not client:
        return None
    try:
        response = client.models.generate_content(
            model=model_name,
            contents=contents,
        )
        return getattr(response, "text", None) if response else None
    except ValueError as e:
        logger.warning("gemini generate_content ValueError (e.g. blocked or non-text): %s", e)
        return None


def get_text_metrics(text: str) -> TextMetrics:
    """
    Call Gemini with configurable model to get humanity (0-100), integrity, rhetoric.
    If API key missing or call fails, returns default zeros.
    """
    cfg = get_config()
    model_name = cfg.get("gemini_model") or "gemini-2.0-flash"
    text_len = len(text or "")
    snippet = (text or "")[:30000]
    logger.info("gemini get_text_metrics input_len=%s snippet_len=%s model=%s", text_len, len(snippet), model_name)
    if not _get_client():
        logger.warning("gemini get_text_metrics skipped: no client (missing api_key or SDK)")
        return TextMetrics(humanity=0.0, integrity=0.0, rhetoric=0.0)
    prompt = """Analyze this web page text and respond with exactly three numbers in this format:
humanity: <0-100>
integrity: <0-100>
rhetoric: <0-100>

- humanity: likelihood the text is human-written (0=likely AI, 100=likely human).
- integrity: how well claims match evidence / factual (0=low, 100=high).
- rhetoric: low emotional manipulation (0=high manipulation/rage-bait, 100=neutral).

Text:
"""
    raw = _generate(model_name, prompt + snippet)
    if not raw:
        logger.warning("gemini get_text_metrics empty response")
        return TextMetrics(humanity=0.0, integrity=0.0, rhetoric=0.0)
    metrics = _parse_metrics(raw)
    logger.info(
        "gemini get_text_metrics response_raw_len=%s parsed humanity=%.1f integrity=%.1f rhetoric=%.1f",
        len(raw),
        metrics.humanity,
        metrics.integrity,
        metrics.rhetoric,
    )
    return metrics


def _parse_metrics(text: str) -> TextMetrics:
    """Parse 'humanity: 75' style lines into TextMetrics."""
    humanity = 0.0
    integrity = 0.0
    rhetoric = 0.0
    for line in text.strip().split("\n"):
        line = line.strip().lower()
        if "humanity" in line:
            humanity = _extract_score(line)
        elif "integrity" in line:
            integrity = _extract_score(line)
        elif "rhetoric" in line:
            rhetoric = _extract_score(line)
    return TextMetrics(humanity=humanity, integrity=integrity, rhetoric=rhetoric)


def _extract_score(line: str) -> float:
    m = re.search(r"[\d.]+", line)
    if m:
        return max(0.0, min(100.0, float(m.group())))
    return 0.0


def fact_check_claim(claim: str, context: str = "") -> tuple[str, str]:
    """
    Use Gemini to fact-check a claim. Returns (verdict, explanation).
    Verdict is one of: true, false, missing_context.
    """
    cfg = get_config()
    model_name = cfg.get("gemini_model") or "gemini-2.0-flash"
    claim_preview = (claim or "")[:80] + ("..." if len(claim or "") > 80 else "")
    logger.info("gemini fact_check_claim claim_preview=%r context_len=%s model=%s", claim_preview, len(context or ""), model_name)
    if not _get_client():
        logger.warning("gemini fact_check_claim skipped: no client")
        return "missing_context", "API not configured."
    prompt = f"""Fact-check this claim. Respond with exactly two lines:
verdict: <true|false|missing_context>
explanation: <one short sentence>

Claim: "{claim}"
"""
    if context:
        prompt += f"\nContext from page: {context[:2000]}"
    raw = _generate(model_name, prompt)
    if not raw:
        logger.warning("gemini fact_check_claim empty response")
        return "missing_context", "No response."
    verdict, explanation = _parse_litmus(raw)
    logger.info("gemini fact_check_claim verdict=%s explanation_preview=%r", verdict, (explanation or "")[:60])
    return verdict, explanation


def _parse_litmus(text: str) -> tuple[str, str]:
    verdict = "missing_context"
    explanation = ""
    for line in text.strip().split("\n"):
        line = line.strip().lower()
        if line.startswith("verdict:"):
            v = line.replace("verdict:", "").strip()
            if v in ("true", "false", "missing_context"):
                verdict = v
        elif line.startswith("explanation:"):
            explanation = line.replace("explanation:", "").strip()
    return verdict, explanation


def classify_links(page_url: str, links: list[str]) -> list[dict]:
    """
    Classify each link as original_source, same_network, or unknown.
    Returns list of { "url": str, "type": str, "label": str }.
    """
    cfg = get_config()
    model_name = cfg.get("gemini_model") or "gemini-2.0-flash"
    links_to_send = links[:30]
    logger.info("gemini classify_links page_url=%r links_count=%s sending=%s model=%s", page_url[:80], len(links or []), len(links_to_send), model_name)
    if not _get_client() or not links:
        fallback = [{"url": u, "type": "unknown", "label": _domain(u)} for u in links[:50]]
        logger.info("gemini classify_links fallback (no client or no links) -> %s items", len(fallback))
        return fallback
    urls_text = "\n".join(links_to_send)
    prompt = f"""Page URL: {page_url}
Outbound links (one per line):
{urls_text}

For each link, respond with one line: <url> | <type> | <short_label>
type is one of: original_source (primary/original source), same_network (same outlet/network), unknown, broken (dead/404).
Use the exact URL as in the list. Short label = domain or site name.
"""
    raw = _generate(model_name, prompt)
    if not raw:
        logger.warning("gemini classify_links empty response")
        return [{"url": u, "type": "unknown", "label": _domain(u)} for u in links[:50]]
    result = _parse_link_classifications(raw, links)
    type_counts = {}
    for r in result:
        t = r.get("type", "unknown")
        type_counts[t] = type_counts.get(t, 0) + 1
    logger.info("gemini classify_links response_len=%s result_count=%s type_counts=%s", len(raw), len(result), type_counts)
    return result


def _domain(url: str) -> str:
    try:
        from urllib.parse import urlparse
        return urlparse(url or "").netloc or url or ""
    except Exception:
        return url or ""


def _parse_link_classifications(text: str, links: list[str]) -> list[dict]:
    result = []
    seen = set()
    for line in text.strip().split("\n"):
        parts = line.split("|")
        if len(parts) >= 2:
            url = parts[0].strip()
            t = parts[1].strip().lower()
            label = parts[2].strip() if len(parts) > 2 else _domain(url)
            if url and url not in seen:
                seen.add(url)
                if t not in ("original_source", "same_network", "unknown", "broken"):
                    t = "unknown"
                result.append({"url": url, "type": t, "label": label or _domain(url)})
    for u in links:
        if u not in seen:
            result.append({"url": u, "type": "unknown", "label": _domain(u)})
        if len(result) >= 50:
            break
    return result


def chat_with_page(page_text: str, message: str, history: list[dict] | None = None) -> str:
    """Oracle: answer user question about the page using Gemini (large context)."""
    cfg = get_config()
    model_name = cfg.get("gemini_model") or "gemini-2.0-flash"
    context = (page_text or "")[:80000]
    logger.info("gemini chat_with_page page_text_len=%s context_len=%s message_len=%s history_len=%s model=%s", len(page_text or ""), len(context), len(message or ""), len(history or []), model_name)
    if not _get_client():
        logger.warning("gemini chat_with_page skipped: no client")
        return "API not configured."
    prompt = f"""You are Odysseus Oracle. Answer the user's question based only on the following web page content. Be concise.

Page content:
{context}

User question: {message}

Answer:"""
    raw = _generate(model_name, prompt)
    reply = (raw or "").strip() or "No response."
    logger.info("gemini chat_with_page reply_len=%s reply_preview=%r", len(reply), reply[:80] + ("..." if len(reply) > 80 else ""))
    return reply


def rewrite_headline(headline: str) -> str:
    """Hype-Filter: rewrite headline to be neutral and factual."""
    cfg = get_config()
    model_name = cfg.get("gemini_model") or "gemini-2.0-flash"
    headline_preview = (headline or "")[:60] + ("..." if len(headline or "") > 60 else "")
    logger.info("gemini rewrite_headline input=%r model=%s", headline_preview, model_name)
    if not _get_client() or not (headline or "").strip():
        logger.debug("gemini rewrite_headline skipped (no client or empty headline)")
        return headline or ""
    prompt = f"""Rewrite this headline to be neutral and factual. Output only the rewritten headline, no explanation.

Headline: {headline[:500]}

Rewritten:"""
    raw = _generate(model_name, prompt)
    out = (raw and raw.strip()) or headline
    logger.info("gemini rewrite_headline output_preview=%r", (out or "")[:80] + ("..." if len(out or "") > 80 else ""))
    return out


def chorus_alternatives(topic_or_summary: str) -> list[dict]:
    """Chorus: suggest alternative perspectives."""
    cfg = get_config()
    model_name = cfg.get("gemini_model") or "gemini-2.0-flash"
    topic_preview = (topic_or_summary or "")[:80] + ("..." if len(topic_or_summary or "") > 80 else "")
    logger.info("gemini chorus_alternatives topic_len=%s topic_preview=%r model=%s", len(topic_or_summary or ""), topic_preview, model_name)
    if not _get_client() or not (topic_or_summary or "").strip():
        logger.debug("gemini chorus_alternatives skipped (no client or empty topic)")
        return []
    prompt = f"""Topic/summary: {topic_or_summary[:2000]}

Suggest 2-3 alternative viewpoints or sources the user could read (different perspective on the same topic). For each, respond with one line: label | url | perspective
Use placeholder URLs like https://example.com/neutral if you don't have real links. Perspective can be: neutral, left, right, international, etc.

Suggestions:"""
    raw = _generate(model_name, prompt)
    if not raw:
        logger.warning("gemini chorus_alternatives empty response")
        return []
    result = _parse_chorus(raw)
    logger.info("gemini chorus_alternatives result_count=%s items=%s", len(result), [r.get("label") for r in result])
    return result


def _parse_chorus(text: str) -> list[dict]:
    out = []
    for line in text.strip().split("\n"):
        parts = line.split("|")
        if len(parts) >= 2:
            label = parts[0].strip()
            url = parts[1].strip()
            perspective = parts[2].strip() if len(parts) > 2 else ""
            if label and url:
                out.append({"label": label, "url": url, "perspective": perspective})
    return out[:5]
