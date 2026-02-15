// Service worker: context menu + API proxy (content scripts cannot fetch localhost from page context).
const API_BASE = "http://localhost:8000";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "odysseus-check",
    title: "Odysseus Check",
    contexts: ["selection"],
  });
});

// Open overlay and trigger analysis only when user clicks the extension icon (saves Gemini credits).
chrome.action.onClicked.addListener((tab) => {
  if (tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: "SHOW_OVERLAY" }).catch(() => {});
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "odysseus-check" || !tab?.id || !info.selectionText) return;
  chrome.tabs.sendMessage(tab.id, { type: "LITMUS_CHECK", claim: info.selectionText });
});

// Proxy API calls from content script so fetch runs in extension context (can reach localhost).
chrome.runtime.onMessage.addListener(
  (msg: { type: string; payload?: unknown }, _sender, sendResponse) => {
    if (msg.type === "ANALYZE_PAGE" && msg.payload) {
      const { url, text, media } = msg.payload as { url: string; text: string; media: string[] };
      fetch(`${API_BASE}/api/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, text, media }),
      })
        .then((res) => {
          if (!res.ok) throw new Error(`Analyze failed: ${res.status}`);
          return res.json();
        })
        .then((data) => sendResponse({ ok: true, data }))
        .catch((err) => sendResponse({ ok: false, error: String(err.message) }));
      return true; // keep channel open for async sendResponse
    }
    if (msg.type === "LITMUS_FETCH" && msg.payload) {
      const { claim, pageUrl, context } = msg.payload as { claim: string; pageUrl: string; context: string };
      fetch(`${API_BASE}/api/litmus`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claim, page_url: pageUrl, context }),
      })
        .then((res) => {
          if (!res.ok) throw new Error(`Litmus failed: ${res.status}`);
          return res.json();
        })
        .then((data) => sendResponse({ ok: true, data }))
        .catch((err) => sendResponse({ ok: false, error: String(err.message) }));
      return true;
    }
    if (msg.type === "ARIADNE_FETCH" && msg.payload) {
      const { url, links, page_summary } = msg.payload as {
        url: string;
        links: string[];
        page_summary?: string;
      };
      fetch(`${API_BASE}/api/ariadne`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, links, page_summary: page_summary || "" }),
      })
        .then((res) => {
          if (!res.ok) throw new Error(`Ariadne failed: ${res.status}`);
          return res.json();
        })
        .then((data) => sendResponse({ ok: true, data }))
        .catch((err) => sendResponse({ ok: false, error: String(err.message) }));
      return true;
    }
    if (msg.type === "CHAT_FETCH" && msg.payload) {
      const { page_text, message, session_id } = msg.payload as {
        page_text: string;
        message: string;
        session_id: string;
      };
      fetch(`${API_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          page_text: page_text,
          message: message,
          session_id: session_id || undefined,
        }),
      })
        .then((res) => {
          if (!res.ok) throw new Error(`Chat failed: ${res.status}`);
          return res.json();
        })
        .then((data) => sendResponse({ ok: true, data }))
        .catch((err) => sendResponse({ ok: false, error: String(err.message) }));
      return true;
    }
    if (msg.type === "CHORUS_FETCH" && msg.payload) {
      const { url, topic_or_summary } = msg.payload as { url: string; topic_or_summary: string };
      fetch(`${API_BASE}/api/chorus`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, topic_or_summary: topic_or_summary || url }),
      })
        .then((res) => {
          if (!res.ok) throw new Error(`Chorus failed: ${res.status}`);
          return res.json();
        })
        .then((data) => sendResponse({ ok: true, data }))
        .catch((err) => sendResponse({ ok: false, error: String(err.message) }));
      return true;
    }
    return false;
  }
);
