// Service worker: context menu + API proxy (content scripts cannot fetch localhost from page context).
const API_BASE = "http://localhost:8000";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "odysseus-check",
    title: "Odysseus Check",
    contexts: ["selection"],
  });
  // Open side panel when user clicks the extension icon (unobstructive, like Chrome's Gemini).
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "odysseus-check" || !tab?.id || !info.selectionText) return;
  chrome.tabs.sendMessage(tab.id, { type: "LITMUS_CHECK", claim: info.selectionText });
});

// Proxy API calls and serve side panel: get page data from active tab's content script.
chrome.runtime.onMessage.addListener(
  (msg: { type: string; payload?: unknown }, _sender, sendResponse) => {
    if (msg.type === "GET_PAGE_DATA") {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tabId = tabs[0]?.id;
        if (!tabId) {
          sendResponse({ ok: false, error: "No active tab" });
          return;
        }
        function tryGetPageData() {
          chrome.tabs.sendMessage(tabId, { type: "GET_PAGE_DATA" }, (data) => {
            if (chrome.runtime.lastError) {
              const errMsg = chrome.runtime.lastError.message || "";
              // Content script not loaded: use inline extraction (no Readability, but works on all tabs)
              if (errMsg.includes("Receiving end does not exist") || errMsg.includes("Could not establish connection")) {
                chrome.scripting.executeScript(
                  {
                    target: { tabId },
                    func: () => {
                      const body = document.body;
                      const text = body?.innerText ? body.innerText.slice(0, 50000) : "";
                      const media: string[] = [];
                      document.querySelectorAll("img[src], video[src], source[src]").forEach((el: Element) => {
                        const src = (el as HTMLImageElement).src;
                        if (src) media.push(src);
                      });
                      document.querySelectorAll("iframe[src]").forEach((el: Element) => {
                        const src = (el as HTMLIFrameElement).src;
                        if (src) media.push(src);
                      });
                      const linkSet = new Set<string>();
                      document.querySelectorAll("a[href]").forEach((el: Element) => {
                        const href = (el as HTMLAnchorElement).href;
                        if (href && href.startsWith("http")) linkSet.add(href);
                      });
                      return {
                        url: location.href,
                        text,
                        media,
                        links: Array.from(linkSet),
                      };
                    },
                  },
                  (results) => {
                    if (chrome.runtime.lastError) {
                      sendResponse({
                        ok: false,
                        error: "Cannot read this page. Try refreshing the tab and opening Odysseus again.",
                      });
                      return;
                    }
                    const data = results?.[0]?.result;
                    if (data && typeof data === "object" && "url" in data) {
                      sendResponse({ ok: true, data });
                    } else {
                      sendResponse({ ok: false, error: "Page could not be read" });
                    }
                  }
                );
                return;
              }
              sendResponse({ ok: false, error: errMsg || "Page could not be read" });
              return;
            }
            sendResponse({ ok: true, data });
          });
        }
        tryGetPageData();
      });
      return true; // keep channel open for async sendResponse
    }
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
