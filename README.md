# Odysseus

**"Tie yourself to the mast of truth."**

Odysseus is an AI-powered browser extension that acts as a real-time **Reality Layer** for the web: it helps users recognize misinformation, verify content, and resist emotional manipulation by analyzing page content (text, images, video) and exposing scores, fact-checks, and provenance.

## Mission

- **Siren's Call (Primary):** Combat misinformation, verify social content, detect deceptive AI.
- **The Agency (Secondary):** Privacy and security for users against social engineering and scams.

## Architecture

- **Frontend:** Chrome Extension (Manifest V3, React/TypeScript) — overlay, content script, context menu.
- **Backend:** FastAPI (Python) — API orchestration, URL normalization, persistent storage.
- **Speed / storage:** Valkey — persistent page records keyed by normalized URL (no reprocessing).
- **Reasoning:** Google Gemini (configurable model) — text scores, fact-check, chat, link classification, headline rewrite.
- **Video (optional):** Twelve Labs — deepfake/summary placeholder; integrate when API key is set.

## Features

1. **The Shield** — Real-time scores per page: Humanity, Integrity, Rhetoric. Optional video metrics.
2. **The Litmus Test** — Select text → right-click “Odysseus Check” → fact-check tooltip.
3. **The Thread of Ariadne** — Link graph: classify citations (original source, same network, broken).
4. **The Oracle** — Chat with the page (POST /api/chat).
5. **The Chorus** — Alternative perspectives (POST /api/chorus).
6. **Hype-Filter** — Neutral headline in analysis response; extension can replace headline in DOM.

## Setup

### Backend

```bash
cd backend
cp .env.example .env
# Edit .env: set GEMINI_API_KEY (required). Optionally VALKEY_URL, GEMINI_MODEL, TWELVE_LABS_API_KEY.
pip install -r requirements.txt
```

### Valkey

```bash
docker-compose up -d
```

### Run backend

```bash
cd backend
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Extension

```bash
cd extension
npm install
npm run build
```

In Chrome: go to `chrome://extensions`, enable Developer mode, “Load unpacked”, select `extension/dist`.

Set the backend URL in `extension/src/shared/api.ts` (`API_BASE`) if not using `http://localhost:8000`.

## Config

- **GEMINI_MODEL** — Model name (default `gemini-1.5-pro`). All Gemini calls use this.
- **VALKEY_URL** — Valkey/Redis URL (default `redis://localhost:6379`).
- **TWELVE_LABS_API_KEY** — Optional; when set, video metrics can be filled.
- **LOG_LEVEL** — `INFO` (default) or `DEBUG`. Backend logs every request (method, path, body size), URL normalization, Valkey get/set (key, hit/miss, payload sizes), Gemini calls (model, input/output lengths, parsed results), and response timing. Set `LOG_LEVEL=DEBUG` for more detail.

## API

- `POST /api/analyze` — Body: `{ "url", "text", "media" }`. Returns normalized_url, text_metrics, media_metrics, neutral_headline, from_cache.
- `POST /api/litmus` — Body: `{ "claim", "page_url", "context" }`. Returns verdict, explanation.
- `POST /api/ariadne` — Body: `{ "url", "links" }`. Returns nodes, edges, alerts.
- `POST /api/chat` — Body: `{ "page_text", "message", "session_id?" }`. Returns reply.
- `POST /api/chorus` — Body: `{ "url", "topic_or_summary" }`. Returns alternatives (label, url, perspective).

## Built with

Chrome Extension (MV3), FastAPI, Valkey, Google Gemini, Twelve Labs (optional).
