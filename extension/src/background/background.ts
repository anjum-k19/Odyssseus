// Service worker: context menu + API proxy (content scripts cannot fetch localhost from page context).
const API_BASE = "http://localhost:8000";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "odysseus-check",
    title: "Odysseus Check",
    contexts: ["selection"],
  });
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
      const { url, links } = msg.payload as { url: string; links: string[] };
      fetch(`${API_BASE}/api/ariadne`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, links }),
      })
        .then((res) => {
          if (!res.ok) throw new Error(`Ariadne failed: ${res.status}`);
          return res.json();
        })
        .then((data) => sendResponse({ ok: true, data }))
        .catch((err) => sendResponse({ ok: false, error: String(err.message) }));
      return true;
    }
    return false;
  }
);
