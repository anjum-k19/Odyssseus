"""Valkey/Redis client for persistent page storage. No TTL on page records."""
import json
import logging
from typing import Any

import redis

from app.config import get_config

logger = logging.getLogger(__name__)

PAGE_KEY_PREFIX = "odysseus:page:"


def _client() -> redis.Redis:
    cfg = get_config()
    return redis.from_url(cfg["valkey_url"], decode_responses=True)


def _page_key(normalized_url: str) -> str:
    return f"{PAGE_KEY_PREFIX}{normalized_url}"


def get_page(normalized_url: str) -> dict[str, Any] | None:
    """Load page record by normalized URL. Returns None if not found."""
    if not normalized_url:
        logger.debug("get_page empty normalized_url -> None")
        return None
    key = _page_key(normalized_url)
    client = _client()
    raw = client.get(key)
    if raw is None:
        logger.info("valkey get_page key=%s -> MISS", key[:120])
        return None
    try:
        data = json.loads(raw)
        content = data.get("content") or {}
        text_len = len((content.get("text") or ""))
        media_count = len(content.get("media") or [])
        logger.info(
            "valkey get_page key=%s -> HIT text_len=%s media_count=%s text_hash=%s",
            key[:120],
            text_len,
            media_count,
            (content.get("text_hash") or "")[:16] + "..." if content.get("text_hash") else "None",
        )
        return data
    except json.JSONDecodeError as e:
        logger.warning("valkey get_page key=%s JSONDecodeError: %s", key[:120], e)
        return None


def set_page(normalized_url: str, record: dict[str, Any]) -> None:
    """Persist page record. No TTL."""
    if not normalized_url:
        logger.debug("set_page empty normalized_url -> skip")
        return
    key = _page_key(normalized_url)
    payload = json.dumps(record)
    client = _client()
    client.set(key, payload)
    content = record.get("content") or {}
    logger.info(
        "valkey set_page key=%s payload_len=%s text_len=%s media_count=%s text_metrics=%s",
        key[:120],
        len(payload),
        len((content.get("text") or "")),
        len(content.get("media") or []),
        record.get("text_metrics"),
    )


LITMUS_KEY_PREFIX = "odysseus:litmus:"
LITMUS_TTL_SECONDS = 3600  # 1 hour


def get_litmus(claim_hash: str) -> dict[str, Any] | None:
    """Get cached litmus result by claim hash."""
    if not claim_hash:
        return None
    key = f"{LITMUS_KEY_PREFIX}{claim_hash[:16]}..."
    client = _client()
    raw = client.get(f"{LITMUS_KEY_PREFIX}{claim_hash}")
    if raw is None:
        logger.info("valkey get_litmus %s -> MISS", key)
        return None
    try:
        data = json.loads(raw)
        logger.info("valkey get_litmus %s -> HIT verdict=%s", key, data.get("verdict"))
        return data
    except json.JSONDecodeError:
        return None


def set_litmus(claim_hash: str, result: dict[str, Any]) -> None:
    """Cache litmus result with TTL."""
    if not claim_hash:
        return
    key = f"{LITMUS_KEY_PREFIX}{claim_hash[:16]}..."
    client = _client()
    client.setex(
        f"{LITMUS_KEY_PREFIX}{claim_hash}",
        LITMUS_TTL_SECONDS,
        json.dumps(result),
    )
    logger.info("valkey set_litmus %s verdict=%s ttl=%s", key, result.get("verdict"), LITMUS_TTL_SECONDS)


ARIADNE_KEY_PREFIX = "odysseus:ariadne:"


def get_ariadne(normalized_url: str) -> dict[str, Any] | None:
    """Get stored Ariadne graph by page URL."""
    if not normalized_url:
        return None
    key = f"{ARIADNE_KEY_PREFIX}{normalized_url[:80]}..."
    client = _client()
    raw = client.get(f"{ARIADNE_KEY_PREFIX}{normalized_url}")
    if raw is None:
        logger.info("valkey get_ariadne %s -> MISS", key)
        return None
    try:
        data = json.loads(raw)
        nodes = len(data.get("nodes") or [])
        edges = len(data.get("edges") or [])
        logger.info("valkey get_ariadne %s -> HIT nodes=%s edges=%s", key, nodes, edges)
        return data
    except json.JSONDecodeError:
        return None


def set_ariadne(normalized_url: str, graph: dict[str, Any]) -> None:
    """Store Ariadne graph (no TTL)."""
    if not normalized_url:
        return
    key = f"{ARIADNE_KEY_PREFIX}{normalized_url[:80]}..."
    payload = json.dumps(graph)
    client = _client()
    client.set(f"{ARIADNE_KEY_PREFIX}{normalized_url}", payload)
    logger.info(
        "valkey set_ariadne %s nodes=%s edges=%s payload_len=%s",
        key,
        len(graph.get("nodes") or []),
        len(graph.get("edges") or []),
        len(payload),
    )


CHAT_KEY_PREFIX = "odysseus:chat:"
CHAT_TTL_SECONDS = 3600


def get_chat_context(session_id: str) -> list[dict] | None:
    """Get cached chat messages for session."""
    if not session_id:
        return None
    key = f"{CHAT_KEY_PREFIX}{session_id[:16]}..."
    client = _client()
    raw = client.get(f"{CHAT_KEY_PREFIX}{session_id}")
    if raw is None:
        logger.info("valkey get_chat_context %s -> MISS", key)
        return None
    try:
        data = json.loads(raw)
        logger.info("valkey get_chat_context %s -> HIT messages=%s", key, len(data) if isinstance(data, list) else "?")
        return data
    except json.JSONDecodeError:
        return None


def set_chat_context(session_id: str, messages: list[dict]) -> None:
    """Cache chat context with TTL."""
    if not session_id:
        return
    key = f"{CHAT_KEY_PREFIX}{session_id[:16]}..."
    client = _client()
    client.setex(
        f"{CHAT_KEY_PREFIX}{session_id}",
        CHAT_TTL_SECONDS,
        json.dumps(messages),
    )
    logger.info("valkey set_chat_context %s messages=%s ttl=%s", key, len(messages), CHAT_TTL_SECONDS)
