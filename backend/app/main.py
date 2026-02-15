"""FastAPI app: CORS, request logging, health, and API routes (analyze, litmus, ariadne, chat, chorus)."""
import logging
import time
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.logging_config import setup_logging
from app.routers import analysis, litmus, ariadne, chat, chorus

setup_logging()
logger = logging.getLogger(__name__)

app = FastAPI(title="Odysseus", version="0.1.0")

@app.middleware("http")
async def log_requests(request: Request, call_next):
    """Log every request: method, path, then body summary for POST /api/*."""
    start = time.perf_counter()
    # Log immediately so we never miss a request (e.g. from extension)
    logger.info("REQUEST %s %s", request.method, request.url.path)
    body_summary = ""
    if request.method == "POST" and request.url.path.startswith("/api/"):
        try:
            body = await request.body()
            body_summary = f" body_len={len(body)}"
            if len(body) <= 500:
                body_summary += f" body_preview={body[:200]!r}"
            logger.info("REQUEST body %s%s", request.url.path, body_summary)
        except Exception as e:
            logger.warning("REQUEST body read failed %s: %s", request.url.path, e)
    response = await call_next(request)
    elapsed_ms = (time.perf_counter() - start) * 1000
    logger.info("RESPONSE %s %s status=%s elapsed_ms=%.0f", request.method, request.url.path, response.status_code, elapsed_ms)
    return response


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow chrome-extension://* in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(analysis.router, prefix="/api", tags=["analysis"])
app.include_router(litmus.router, prefix="/api", tags=["litmus"])
app.include_router(ariadne.router, prefix="/api", tags=["ariadne"])
app.include_router(chat.router, prefix="/api", tags=["chat"])
app.include_router(chorus.router, prefix="/api", tags=["chorus"])


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/ping")
def ping():
    """Simple endpoint for extension to verify backend is reachable (e.g. from background script)."""
    return {"status": "ok", "service": "odysseus"}
