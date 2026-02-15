import React from "react";
import { createRoot } from "react-dom/client";
import { Readability } from "@mozilla/readability";
import { ShieldOverlay } from "../overlay/ShieldOverlay";
import type { AnalyzeResponse, AriadneResponse } from "../shared/api";

const MAX_TEXT_LENGTH = 50000;
const MIN_READABILITY_LENGTH = 80; // If Readability returns less, fall back to heuristic

/**
 * Extract main article/content text to send to the backend.
 * Uses Mozilla Readability (Firefox Reader View algorithm) to strip ads, sidebars,
 * related posts, and nav, then falls back to article/main/body if Readability fails.
 */
function extractPageText(): string {
  const body = document.body;
  if (!body) return "";

  try {
    const documentClone = document.cloneNode(true) as Document;
    const reader = new Readability(documentClone, {
      charThreshold: 100,
    });
    const article = reader.parse();
    if (article?.textContent && article.textContent.trim().length >= MIN_READABILITY_LENGTH) {
      return article.textContent.trim().slice(0, MAX_TEXT_LENGTH);
    }
  } catch {
    // Readability can throw on odd DOMs; fall through to heuristic
  }

  const article =
    document.querySelector("article") ||
    document.querySelector("main") ||
    document.querySelector("[role='main']");
  const root = article || body;
  return (root as HTMLElement).innerText?.slice(0, MAX_TEXT_LENGTH) ?? "";
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

function renderOverlay(
  root: ReturnType<typeof createRoot>,
  opts: {
    loading: boolean;
    metrics: React.ComponentProps<typeof ShieldOverlay>["metrics"];
    fromCache?: boolean;
    pageUrl: string;
    links: string[];
    onClose: () => void;
  }
) {
  root.render(
    <ShieldOverlay
      loading={opts.loading}
      metrics={opts.metrics}
      fromCache={opts.fromCache}
      pageUrl={opts.pageUrl}
      links={opts.links}
      onAriadneLoad={() => {}}
      onClose={opts.onClose}
      fetchAriadne={fetchAriadne}
    />
  );
}

const LOW_SCORE_THRESHOLD = 34;

function isLowScore(metrics: AnalyzeResponse["text_metrics"]): boolean {
  return (
    metrics.humanity < LOW_SCORE_THRESHOLD ||
    metrics.integrity < LOW_SCORE_THRESHOLD ||
    metrics.rhetoric < LOW_SCORE_THRESHOLD
  );
}

const HIGHLIGHT_STYLE_ID = "odysseus-low-score-styles";
const CLASS_MEDIA = "odysseus-highlight-media";
const CLASS_EXCERPT = "odysseus-highlight-excerpt";

function normalizeText(s: string): string {
  return (s || "").replace(/\s+/g, " ").trim();
}

/** Block-level elements that can contain the excerpt text. */
const TEXT_BLOCK_SELECTOR = "p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, figcaption, [role='paragraph']";

function findBlocksContainingExcerpt(excerpt: string): Element[] {
  const normalizedExcerpt = normalizeText(excerpt);
  if (normalizedExcerpt.length < 10) return [];
  const blocks = document.querySelectorAll(TEXT_BLOCK_SELECTOR);
  const matched: Element[] = [];
  for (const block of blocks) {
    const text = (block as HTMLElement).innerText || "";
    if (!text) continue;
    if (normalizeText(text).includes(normalizedExcerpt) || normalizedExcerpt.includes(normalizeText(text))) {
      matched.push(block);
    }
  }
  return matched;
}

function ensureHighlightStyles() {
  if (document.getElementById(HIGHLIGHT_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = HIGHLIGHT_STYLE_ID;
  style.textContent = `
    .${CLASS_MEDIA} {
      outline: 3px solid #f44336 !important;
      outline-offset: 2px !important;
      border-radius: 4px;
    }
    .${CLASS_EXCERPT} {
      background: rgba(244, 67, 54, 0.12) !important;
      box-shadow: inset 0 0 0 1px rgba(244, 67, 54, 0.35);
    }
  `;
  (document.head || document.documentElement).appendChild(style);
}

function applyLowScoreHighlights(
  metrics: AnalyzeResponse["text_metrics"],
  contributing_excerpts?: Record<string, string[]>
) {
  if (!isLowScore(metrics)) return;
  ensureHighlightStyles();
  document.querySelectorAll("img[src], video").forEach((el) => {
    el.classList.add(CLASS_MEDIA);
  });
  if (contributing_excerpts && Object.keys(contributing_excerpts).length > 0) {
    const seen = new Set<Element>();
    for (const excerpts of Object.values(contributing_excerpts)) {
      for (const excerpt of excerpts) {
        for (const block of findBlocksContainingExcerpt(excerpt)) {
          if (!seen.has(block)) {
            seen.add(block);
            block.classList.add(CLASS_EXCERPT);
          }
        }
      }
    }
  }
}

function clearLowScoreHighlights() {
  document.querySelectorAll(`.${CLASS_MEDIA}`).forEach((el) => {
    el.classList.remove(CLASS_MEDIA);
  });
  document.querySelectorAll(`.${CLASS_EXCERPT}`).forEach((el) => {
    el.classList.remove(CLASS_EXCERPT);
  });
}

let odysseusRootEl: HTMLDivElement | null = null;
let odysseusReactRoot: ReturnType<typeof createRoot> | null = null;
let lastPageUrl: string | null = null;
let cachedMetrics: AnalyzeResponse["text_metrics"] | null = null;
let cachedFromCache = false;
let cachedContributingExcerpts: Record<string, string[]> | undefined = undefined;

function hideOverlay() {
  if (odysseusRootEl) odysseusRootEl.style.display = "none";
  clearLowScoreHighlights();
}

function showOverlay() {
  if (odysseusRootEl) odysseusRootEl.style.display = "block";
}

function openAndMaybeAnalyze() {
  const url = location.href;
  const text = extractPageText();
  const media = extractMedia();
  const links = extractLinks();

  if (!odysseusRootEl || !odysseusReactRoot) {
    odysseusRootEl = document.createElement("div");
    odysseusRootEl.id = "odysseus-root";
    document.body?.appendChild(odysseusRootEl);
    odysseusReactRoot = createRoot(odysseusRootEl);
  }

  const onClose = () => hideOverlay();

  showOverlay();

  // Same page and we already have metrics: show cached, no API call
  if (lastPageUrl === url && cachedMetrics !== null) {
    if (isLowScore(cachedMetrics)) applyLowScoreHighlights(cachedMetrics, cachedContributingExcerpts);
    renderOverlay(odysseusReactRoot, {
      loading: false,
      metrics: cachedMetrics,
      fromCache: cachedFromCache,
      pageUrl: url,
      links,
      onClose,
    });
    return;
  }

  lastPageUrl = url;
  cachedMetrics = null;
  cachedFromCache = false;
  cachedContributingExcerpts = undefined;

  renderOverlay(odysseusReactRoot, {
    loading: true,
    metrics: null,
    pageUrl: url,
    links,
    onClose,
  });

  // Log what is being sent to the backend (for debugging / verifying Readability output)
  const previewLen = 500;
  console.log("[Odysseus] Sending to backend:", {
    url: url.slice(0, 80) + (url.length > 80 ? "…" : ""),
    textLength: text.length,
    mediaCount: media.length,
    textPreview: text.length ? text.slice(0, previewLen) + (text.length > previewLen ? "…" : "") : "(empty)",
  });

  chrome.runtime.sendMessage(
    { type: "ANALYZE_PAGE", payload: { url, text, media } },
    (res: { ok: boolean; data?: AnalyzeResponse; error?: string } | undefined) => {
      if (res?.ok && res.data) {
        const data = res.data as AnalyzeResponse;
        cachedMetrics = data.text_metrics;
        cachedFromCache = data.from_cache;
        cachedContributingExcerpts = data.contributing_excerpts;
        if (data.neutral_headline) applyHypeFilter(data.neutral_headline);
        if (isLowScore(data.text_metrics)) applyLowScoreHighlights(data.text_metrics, data.contributing_excerpts);
        renderOverlay(odysseusReactRoot!, {
          loading: false,
          metrics: data.text_metrics,
          fromCache: data.from_cache,
          pageUrl: url,
          links,
          onClose,
        });
      } else {
        renderOverlay(odysseusReactRoot!, {
          loading: false,
          metrics: null,
          pageUrl: url,
          links,
          onClose,
        });
      }
    }
  );
}

function initContentScript() {
  // Only listen for messages; do not open overlay or call API until user clicks extension icon.
  chrome.runtime.onMessage.addListener(
    (msg: { type?: string }, _sender, sendResponse) => {
      if (msg.type === "SHOW_OVERLAY") {
        openAndMaybeAnalyze();
        sendResponse({ ok: true });
        return true;
      }
      return false;
    }
  );
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initContentScript);
} else {
  initContentScript();
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
