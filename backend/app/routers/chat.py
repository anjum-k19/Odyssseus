"""Oracle: chat with page."""
import logging
from fastapi import APIRouter

from app.models import ChatRequest, ChatResponse
from app.services.valkey_client import get_chat_context, set_chat_context
from app.services.gemini_service import chat_with_page

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    """Answer user question about the page. Optional session_id for context cache."""
    logger.info("chat received page_text_len=%s message_len=%s message_preview=%r session_id=%r", len(req.page_text or ""), len(req.message or ""), (req.message or "")[:50], (req.session_id or "")[:16] or None)
    history = get_chat_context(req.session_id) if req.session_id else None
    logger.info("chat history from_cache=%s messages=%s", history is not None, len(history) if history else 0)
    reply = chat_with_page(req.page_text, req.message, history)
    if req.session_id and history is not None:
        new_history = history + [{"role": "user", "content": req.message}, {"role": "assistant", "content": reply}]
        set_chat_context(req.session_id, new_history[-20:])
        logger.info("chat updated session history len=%s", len(new_history[-20:]))
    logger.info("chat reply_len=%s", len(reply or ""))
    return ChatResponse(reply=reply, from_cache=False)
