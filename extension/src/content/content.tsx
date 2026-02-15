import React from "react";
import { createRoot } from "react-dom/client";
import { ShieldOverlay } from "../overlay/ShieldOverlay";
import type { AnalyzeResponse, AriadneResponse } from "../shared/api";

function extractPageText(): string {
  const body = document.body;
  if (!body) return "";
  const article =
    document.querySelector("article") ||
    document.querySelector("main") ||
    document.querySelector("[role='main']");
  const root = article || body;
  return (root as HTMLElement).innerText?.slice(0, 50000) ?? "";
}

function extractMedia(): string[] {
  const urls: string[] = [];
  document.querySelectorAll("img[src], video[src], source[src]").forEach((el) => {
    const src = (el as HTMLImageElement | HTMLVideoElement | HTMLSourceElement).src;
    if (src) urls.push(src);
  });
  document.querySelectorAll("iframe[src]").forEach((el) => {
    const src = (el as HTMLIFrameElement).src;
    if (src) urls.push(src);
  });
  return urls;
}

function extractLinks(): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  document.querySelectorAll("a[href]").forEach((el) => {
    const href = (el as HTMLAnchorElement).href;
    if (href && href.startsWith("http") && !seen.has(href)) {
      seen.add(href);
      urls.push(href);
    }
  });
  return urls;
}

function main() {
  const rootEl = document.createElement("div");
  rootEl.id = "odysseus-root";
  document.body?.appendChild(rootEl);
  const root = createRoot(rootEl);

  const url = location.href;
  const text = extractPageText();
  const media = extractMedia();
  const links = extractLinks();

  const fetchAriadne = (pageUrl: string, linkList: string[]) =>
    new Promise<AriadneResponse>((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: "ARIADNE_FETCH", payload: { url: pageUrl, links: linkList } },
        (res: { ok: boolean; data?: AriadneResponse; error?: string } | undefined) => {
          if (res?.ok && res.data) resolve(res.data as AriadneResponse);
          else reject(new Error(res?.error || "Ariadne failed"));
        }
      );
    });

  root.render(
    <ShieldOverlay
      loading={true}
      metrics={null}
      pageUrl={url}
      links={links}
      onAriadneLoad={() => {}}
      fetchAriadne={fetchAriadne}
    />
  );

  // Use background script to fetch (content script cannot reach localhost from page origin).
  chrome.runtime.sendMessage(
    { type: "ANALYZE_PAGE", payload: { url, text, media } },
    (res: { ok: boolean; data?: AnalyzeResponse; error?: string } | undefined) => {
      if (res?.ok && res.data) {
        const data = res.data as AnalyzeResponse;
        if (data.neutral_headline) applyHypeFilter(data.neutral_headline);
        root.render(
          <ShieldOverlay
            loading={false}
            metrics={data.text_metrics}
            fromCache={data.from_cache}
            pageUrl={url}
            links={links}
            onAriadneLoad={() => {}}
            fetchAriadne={fetchAriadne}
          />
        );
      } else {
        root.render(
          <ShieldOverlay
            loading={false}
            metrics={null}
            pageUrl={url}
            links={links}
            onAriadneLoad={() => {}}
            fetchAriadne={fetchAriadne}
          />
        );
      }
    }
  );
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", main);
} else {
  main();
}

// Litmus: context menu "Odysseus Check" sends message; show tooltip with verdict.
chrome.runtime.onMessage.addListener(
  (msg: { type?: string; claim?: string }, _sender, sendResponse) => {
    if (msg.type !== "LITMUS_CHECK" || !msg.claim) return;
    const claim = msg.claim;
    const pageUrl = location.href;
    const context = extractPageText().slice(0, 500);
    chrome.runtime.sendMessage(
      { type: "LITMUS_FETCH", payload: { claim, pageUrl, context } },
      (res: { ok: boolean; data?: { verdict: string; explanation: string }; error?: string } | undefined) => {
        if (res?.ok && res.data) {
          showLitmusTooltip(claim, res.data.verdict, res.data.explanation);
          sendResponse({ ok: true });
        } else {
          showLitmusTooltip(claim, "missing_context", res?.error || "Check failed.");
          sendResponse({ ok: false });
        }
      }
    );
    return true; // keep channel open for sendResponse
  }
);

function showLitmusTooltip(claim: string, verdict: string, explanation: string) {
  const existing = document.getElementById("odysseus-litmus-tooltip");
  if (existing) existing.remove();
  const sel = window.getSelection();
  let x = 20,
    y = 100;
  if (sel && sel.rangeCount > 0) {
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    x = rect.left;
    y = rect.bottom + 8;
  }
  const el = document.createElement("div");
  el.id = "odysseus-litmus-tooltip";
  el.style.cssText = `
    position: fixed; left: ${x}px; top: ${y}px; z-index: 2147483647;
    font-family: system-ui, sans-serif; font-size: 12px;
    background: rgba(20,20,24,0.96); color: #e8e6e3;
    padding: 10px 14px; border-radius: 8px; max-width: 320px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.4); border: 1px solid rgba(212,175,55,0.4);
  `;
  const verdictColor =
    verdict === "true" ? "#6b9b6b" : verdict === "false" ? "#b55" : "#a0a0a0";
  el.innerHTML = `
    <div style="color: #d4af37; font-weight: 600; margin-bottom: 6px;">Odysseus Litmus</div>
    <div style="margin-bottom: 4px; color: #888;">${escapeHtml(claim.slice(0, 120))}${claim.length > 120 ? "…" : ""}</div>
    <div style="font-weight: 600; color: ${verdictColor}; text-transform: capitalize;">${escapeHtml(verdict.replace("_", " "))}</div>
    <div style="margin-top: 4px; color: #a0a0a0;">${escapeHtml(explanation)}</div>
  `;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 12000);
}

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function applyHypeFilter(neutralHeadline: string): void {
  const h1 = document.querySelector("h1");
  if (h1 && neutralHeadline && !h1.getAttribute("data-odysseus-rewritten")) {
    h1.setAttribute("data-odysseus-original", h1.textContent || "");
    h1.textContent = neutralHeadline;
    h1.setAttribute("data-odysseus-rewritten", "true");
  }
}
