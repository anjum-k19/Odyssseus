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


LOW_SCORE_THRESHOLD = 34


def get_contributing_excerpts(text: str, text_metrics: TextMetrics) -> dict[str, list[str]]:
    """
    When any score is below LOW_SCORE_THRESHOLD, ask Gemini for 2-5 exact quotes from the text
    that most contributed to that low score. Returns e.g. {"humanity": ["quote1", "quote2"], ...}.
    """
    if not _get_client() or not (text or "").strip():
        return {}
    low_metrics = []
    if text_metrics.humanity < LOW_SCORE_THRESHOLD:
        low_metrics.append(("humanity", "passages that seem AI-generated or lack human nuance"))
    if text_metrics.integrity < LOW_SCORE_THRESHOLD:
        low_metrics.append(("integrity", "passages with unsupported claims or weak sourcing"))
    if text_metrics.rhetoric < LOW_SCORE_THRESHOLD:
        low_metrics.append(("rhetoric", "passages with emotional manipulation or sensationalism"))
    if not low_metrics:
        return {}
    cfg = get_config()
    model_name = cfg.get("gemini_model") or "gemini-2.0-flash"
    snippet = (text or "")[:25000]
    lines = [
        f"- {name} (score {getattr(text_metrics, name):.0f}): {desc}"
        for name, desc in low_metrics
    ]
    prompt = f"""This web page text was scored. The following metrics are LOW. For each low metric, list 2-5 exact short quotes from the text below that most contributed to that low score. Each quote must be a contiguous substring copied verbatim from the text.

Low metrics:
{chr(10).join(lines)}

Output format (use these exact section headers). Under each header put one quote per line. Only include sections for metrics listed above.

humanity_excerpts:
<one quote per line, or "none" if not applicable>

integrity_excerpts:
<one quote per line, or "none" if not applicable>

rhetoric_excerpts:
<one quote per line, or "none" if not applicable>

Text:
{snippet}
"""
    raw = _generate(model_name, prompt)
    if not raw:
        logger.warning("gemini get_contributing_excerpts empty response")
        return {}
    result = _parse_contributing_excerpts(raw)
    logger.info(
        "gemini get_contributing_excerpts low_metrics=%s excerpt_counts=%s",
        [m[0] for m in low_metrics],
        {k: len(v) for k, v in result.items()},
    )
    return result


def _parse_contributing_excerpts(text: str) -> dict[str, list[str]]:
    """Parse humanity_excerpts:, integrity_excerpts:, rhetoric_excerpts: sections into lists of non-empty lines."""
    result: dict[str, list[str]] = {"humanity": [], "integrity": [], "rhetoric": []}
    current: str | None = None
    for line in text.strip().split("\n"):
        line_stripped = line.strip()
        lower = line_stripped.lower()
        if lower.startswith("humanity_excerpts"):
            current = "humanity"
            continue
        if lower.startswith("integrity_excerpts"):
            current = "integrity"
            continue
        if lower.startswith("rhetoric_excerpts"):
            current = "rhetoric"
            continue
        if current and line_stripped and lower != "none":
            # Skip lines that look like section headers or instructions
            if ":" in line_stripped and len(line_stripped) < 60:
                maybe_label = line_stripped.split(":")[0].strip().lower()
                if maybe_label in ("humanity", "integrity", "rhetoric"):
                    continue
            result[current].append(line_stripped)
    return {k: v for k, v in result.items() if v}


def get_score_explanations(text: str, text_metrics: TextMetrics) -> dict[str, str]:
    """
    For each metric below LOW_SCORE_THRESHOLD, get a 1-2 sentence specific explanation of
    the argument or evidence in the text that led to that low score. Returns e.g. {"humanity": "...", ...}.
    """
    if not _get_client() or not (text or "").strip():
        return {}
    low_metrics = []
    if text_metrics.humanity < LOW_SCORE_THRESHOLD:
        low_metrics.append("humanity")
    if text_metrics.integrity < LOW_SCORE_THRESHOLD:
        low_metrics.append("integrity")
    if text_metrics.rhetoric < LOW_SCORE_THRESHOLD:
        low_metrics.append("rhetoric")
    if not low_metrics:
        return {}
    cfg = get_config()
    model_name = cfg.get("gemini_model") or "gemini-2.0-flash"
    snippet = (text or "")[:25000]
    prompt = f"""This web page text was scored. The following metrics are LOW. For each, write 1-2 sentences that explain the specific argument or evidence in the text that led to this low score. Be concrete: cite what in the text (tone, claims, wording) drove the score down.

Low metrics: {", ".join(low_metrics)}
Scores: humanity={text_metrics.humanity:.0f}, integrity={text_metrics.integrity:.0f}, rhetoric={text_metrics.rhetoric:.0f}

Output format (use these exact headers). One line per metric.

humanity_explanation: <one or two sentences, or "none" if humanity was not low>

integrity_explanation: <one or two sentences, or "none" if integrity was not low>

rhetoric_explanation: <one or two sentences, or "none" if rhetoric was not low>

Text:
{snippet}
"""
    raw = _generate(model_name, prompt)
    if not raw:
        return {}
    result = _parse_score_explanations(raw, low_metrics)
    logger.info("gemini get_score_explanations low_metrics=%s keys=%s", low_metrics, list(result.keys()))
    return result


def _parse_score_explanations(text: str, low_metrics: list[str]) -> dict[str, str]:
    out: dict[str, str] = {}
    current: str | None = None
    buf: list[str] = []
    for line in text.strip().split("\n"):
        line_stripped = line.strip()
        lower = line_stripped.lower()
        found_header = False
        for key in ("humanity_explanation", "integrity_explanation", "rhetoric_explanation"):
            metric = key.replace("_explanation", "")
            if lower.startswith(key + ":") or lower.startswith(key + " "):
                if current and buf:
                    out[current] = " ".join(buf).strip()
                current = metric if metric in low_metrics else None
                rest = line_stripped.split(":", 1)[-1].strip() if ":" in line_stripped else ""
                buf = [rest] if rest and rest.lower() != "none" else []
                found_header = True
                break
        if not found_header and current and line_stripped and line_stripped.lower() != "none":
            buf.append(line_stripped)
    if current and buf:
        out[current] = " ".join(buf).strip()
    return {k: v for k, v in out.items() if v and k in low_metrics}


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


def substantiate_claims(page_url: str, page_summary: str, classified_links: list[dict]) -> tuple[str, dict[str, str]]:
    """
    Given page summary and classified links, return (substantiation_summary, link_notes).
    substantiation_summary: one short paragraph on whether the page's claims are likely substantiated.
    link_notes: url -> short note e.g. "Primary source for the study" or "Same outlet – verify elsewhere".
    """
    if not _get_client() or not (page_summary or "").strip() or not classified_links:
        return "", {}
    cfg = get_config()
    model_name = cfg.get("gemini_model") or "gemini-2.0-flash"
    summary_snippet = (page_summary or "")[:4000]
    links_blob = "\n".join(
        f"- {c.get('url', '')} (type: {c.get('type', 'unknown')}, label: {c.get('label', '')})"
        for c in classified_links[:25]
    )
    prompt = f"""Page URL: {page_url}

Page summary/content (excerpt):
{summary_snippet}

Outbound links (with classification type):
{links_blob}

1. In one short paragraph, assess whether the page's main claims appear to be substantiated by these links. Consider: Do any links point to primary/original sources? Are many links same-network (same outlet) and thus not independent verification? Can a reader actually verify claims using these links?

2. For each link URL above, give one short note (e.g. "Primary source for the study", "Same publisher – cannot independently verify", "Likely supports claim", "Unclear relevance"). Use the exact URL as key.

Output format:

SUBSTANTIATION_SUMMARY:
<one paragraph>

LINK_NOTES:
<url> | <note>
<url> | <note>
..."""
    raw = _generate(model_name, prompt)
    if not raw:
        return "", {}
    summary = ""
    notes: dict[str, str] = {}
    in_summary = False
    in_notes = False
    summary_lines: list[str] = []
    for line in raw.strip().split("\n"):
        stripped = line.strip()
        lower = stripped.lower()
        if lower.startswith("substantiation_summary:") or lower.startswith("substantiationsummary:"):
            in_summary = True
            in_notes = False
            rest = stripped.split(":", 1)[-1].strip()
            if rest:
                summary_lines.append(rest)
            continue
        if lower.startswith("link_notes:") or lower.startswith("linknotes:"):
            in_summary = False
            in_notes = True
            continue
        if in_summary and stripped:
            summary_lines.append(stripped)
        if in_notes and "|" in stripped:
            parts = stripped.split("|", 1)
            url = (parts[0].strip() or "").strip()
            note = (parts[1].strip() or "").strip()[:200]
            if url and note:
                notes[url] = note
    summary = " ".join(summary_lines).strip()[:800]
    logger.info("gemini substantiate_claims summary_len=%s notes_count=%s", len(summary), len(notes))
    return summary, notes


def chat_with_page(page_text: str, message: str, history: list[dict] | None = None) -> str:
    """Oracle: answer user question about the page using Gemini (large context). Uses history for multi-turn context."""
    cfg = get_config()
    model_name = cfg.get("gemini_model") or "gemini-2.0-flash"
    context = (page_text or "")[:80000]
    # Use last 10 messages (5 turns) for context
    recent = (history or [])[-10:]
    history_blob = ""
    if recent:
        lines = []
        for msg in recent:
            role = msg.get("role", "")
            content = (msg.get("content") or "").strip()
            if content:
                lines.append(f"{role}: {content}")
        if lines:
            history_blob = "\nPrevious conversation:\n" + "\n".join(lines) + "\n\n"
    logger.info("gemini chat_with_page page_text_len=%s context_len=%s message_len=%s history_len=%s model=%s", len(page_text or ""), len(context), len(message or ""), len(history or []), model_name)
    if not _get_client():
        logger.warning("gemini chat_with_page skipped: no client")
        return "API not configured."
    prompt = f"""You are Odysseus Oracle. Answer the user's question based only on the following web page content and the previous conversation (if any). Be concise.
{history_blob}
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


def _chorus_search_queries(topic_or_summary: str) -> list[str]:
    """Ask Gemini for 2-3 search queries to find real articles with alternative perspectives. Returns list of query strings (no URLs)."""
    cfg = get_config()
    model_name = cfg.get("gemini_model") or "gemini-2.0-flash"
    if not _get_client() or not (topic_or_summary or "").strip():
        return []
    prompt = f"""Topic or article summary: {topic_or_summary[:2000]}

Generate exactly 2 or 3 short search queries that would find real news articles or opinion pieces offering a different perspective on this same topic. Output one search query per line. Do not include any URLs or labels—only the search query text. Example:
alternative view on [topic]
[topic] criticism analysis
[topic] fact check different perspective

Search queries:"""
    raw = _generate(model_name, prompt)
    if not raw:
        return []
    queries = [q.strip() for q in raw.strip().split("\n") if q.strip()][:3]
    return queries


def chorus_alternatives(topic_or_summary: str) -> list[dict]:
    """Chorus: real articles via search API. Uses Gemini to build search queries, then Serper for real links."""
    from app.services.search_service import search
    topic_or_summary = (topic_or_summary or "").strip()
    if not topic_or_summary:
        return []
    cfg = get_config()
    has_serper = bool((cfg.get("serper_api_key") or "").strip())
    if not has_serper:
        logger.warning("chorus_alternatives: SERPER_API_KEY not set; add it for real article links")
        return []
    queries = _chorus_search_queries(topic_or_summary)
    if not queries:
        # Fallback: single query from topic
        queries = [topic_or_summary[:100]]
    seen_urls: set[str] = set()
    out: list[dict] = []
    for q in queries:
        results = search(q, num=3)
        for r in results:
            link = (r.get("link") or "").strip()
            if not link or link in seen_urls:
                continue
            seen_urls.add(link)
            out.append({
                "label": (r.get("title") or link)[:150],
                "url": link,
                "perspective": (r.get("snippet") or "alternative perspective")[:200],
            })
            if len(out) >= 5:
                break
        if len(out) >= 5:
            break
    logger.info("chorus_alternatives queries=%s result_count=%s", queries, len(out))
    return out
