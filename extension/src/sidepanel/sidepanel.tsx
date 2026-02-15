/**
 * Odysseus side panel: opens beside the page (like Chrome's Gemini panel).
 * Fetches page data from the active tab via background, then calls analyze API directly
 * (avoids service worker going idle during the long analyze request).
 */
import React, { useState, useEffect, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { ShieldOverlay } from "../overlay/ShieldOverlay";
import type { AnalyzeResponse, AriadneResponse } from "../shared/api";
import { API_BASE } from "../shared/api";
import type { ChorusLinkItem } from "../overlay/ShieldOverlay";

interface PageData {
  url: string;
  text: string;
  media: string[];
  links: string[];
}

function send<T>(type: string, payload?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      payload !== undefined ? { type, payload } : { type },
      (res: { ok?: boolean; data?: T; error?: string } | undefined) => {
        if (res?.ok === false || res?.error) reject(new Error(res?.error || `${type} failed`));
        else if (res?.data !== undefined) resolve(res.data as T);
        else reject(new Error(`${type} failed`));
      }
    );
  });
}

/** Call analyze API directly from the panel so the long request isn't lost when the service worker sleeps. */
async function fetchAnalyze(url: string, text: string, media: string[]): Promise<AnalyzeResponse> {
  const res = await fetch(`${API_BASE}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, text, media }),
  });
  if (!res.ok) throw new Error(`Analyze failed: ${res.status}`);
  return res.json() as Promise<AnalyzeResponse>;
}

function SidePanelApp() {
  const [pageData, setPageData] = useState<PageData | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalyzeResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const loadForActiveTab = useCallback(() => {
    setLoading(true);
    setPageData(null);
    setAnalysis(null);
    setPageError(null);
    send<PageData>("GET_PAGE_DATA")
      .then((data) => {
        setPageData(data);
        setPageError(null);
        return fetchAnalyze(data.url, data.text, data.media);
      })
      .then((data) => {
        setAnalysis(data);
      })
      .catch((err) => {
        setPageError(
          err?.message || "Could not read page. Try refreshing the tab (F5 or Cmd+R) and open Odysseus again."
        );
        setPageData(null);
        setAnalysis(null);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadForActiveTab();
  }, [loadForActiveTab]);

  // When user switches to another tab, refresh to show that tab's analysis
  useEffect(() => {
    const listener = (msg: { type?: string }) => {
      if (msg.type === "ACTIVE_TAB_CHANGED") loadForActiveTab();
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [loadForActiveTab]);

  const fetchChat = useCallback(
    (message: string) =>
      send<{ reply: string }>("CHAT_FETCH", {
        page_text: pageData?.text ?? "",
        message,
        session_id: pageData?.url ?? "",
      }).then((d) => d.reply),
    [pageData]
  );

  const fetchChorus = useCallback(
    (url: string, topicOrSummary: string) =>
      send<{ alternatives: ChorusLinkItem[] }>("CHORUS_FETCH", {
        url,
        topic_or_summary: topicOrSummary,
      }).then((d) => d.alternatives),
    []
  );

  const fetchAriadne = useCallback(
    (url: string, links: string[], pageSummary?: string) =>
      send<AriadneResponse>("ARIADNE_FETCH", {
        url,
        links,
        page_summary: pageSummary ?? "",
      }),
    []
  );

  const sidePanelContainerStyle: React.CSSProperties = {
    position: "relative",
    width: "100%",
    maxWidth: "none",
    minWidth: 0,
    maxHeight: "none",
    height: "100%",
    borderRadius: 0,
  };

  if (loading && !pageData) {
    return (
      <div
        style={{
          padding: 24,
          textAlign: "center",
          color: "#c0c0c0",
          minHeight: 120,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 15,
        }}
      >
        Reading page…
      </div>
    );
  }

  if (pageError) {
    return (
      <div style={{ padding: 20, color: "#e57373" }}>
        <strong>Odysseus</strong>
        <p>{pageError}</p>
        <p style={{ fontSize: 12, color: "#888" }}>
          Refresh the tab (F5), then click the Odysseus icon again. Chrome:// and extension pages are not supported.
        </p>
      </div>
    );
  }

  return (
    <ShieldOverlay
      loading={loading}
      metrics={analysis?.text_metrics ?? null}
      fromCache={analysis?.from_cache}
      scoreExplanations={analysis?.score_explanations}
      pageUrl={pageData?.url ?? ""}
      links={pageData?.links ?? []}
      pageText={pageData?.text ?? ""}
      sessionId={pageData?.url ?? ""}
      fetchChat={fetchChat}
      fetchChorus={fetchChorus}
      fetchAriadne={fetchAriadne}
      containerStyle={sidePanelContainerStyle}
      hideCloseButton
    />
  );
}

function mount() {
  let root = document.getElementById("root");
  if (!root) {
    root = document.createElement("div");
    root.id = "root";
    root.style.minHeight = "400px";
    root.style.padding = "20px";
    document.body.appendChild(root);
  } else {
    root.textContent = ""; // clear "Loading Odysseus…" before React mounts
  }
  try {
    createRoot(root).render(<SidePanelApp />);
  } catch (err) {
    root.textContent = "";
    const msg = document.createElement("div");
    msg.style.padding = "20px";
    msg.style.color = "#e57373";
    msg.innerHTML = "<strong>Odysseus failed to load</strong><pre>" + String(err) + "</pre>";
    root.appendChild(msg);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount);
} else {
  mount();
}
