import React, { useState } from "react";
import type { TextMetrics as TextMetricsType, AriadneResponse } from "../shared/api";
import { SCORE_CONFIG, type ScoreKey } from "../config/scores";

/** Score 0–100 → "green" | "yellow" | "red" */
function scoreColor(score: number): "green" | "yellow" | "red" {
  if (score >= 67) return "green";
  if (score >= 34) return "yellow";
  return "red";
}

const scoreBarColors = {
  green: { bg: "rgba(76, 175, 80, 0.35)", border: "#4caf50", text: "#81c784" },
  yellow: { bg: "rgba(255, 193, 7, 0.3)", border: "#ffc107", text: "#ffca28" },
  red: { bg: "rgba(244, 67, 54, 0.35)", border: "#f44336", text: "#e57373" },
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: "fixed",
    top: 16,
    right: 16,
    zIndex: 2147483647,
    fontFamily: "system-ui, sans-serif",
    fontSize: 14,
    background: "rgba(20, 20, 24, 0.95)",
    color: "#e8e6e3",
    padding: "16px 20px",
    borderRadius: 12,
    boxShadow: "0 4px 16px rgba(0,0,0,0.45)",
    border: "1px solid rgba(212, 175, 55, 0.45)",
    minWidth: 280,
    maxWidth: 420,
    maxHeight: "85vh",
    overflow: "auto",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  title: {
    marginBottom: 0,
    fontWeight: 700,
    fontSize: 16,
    color: "#d4af37",
  },
  closeBtn: {
    background: "transparent",
    border: "none",
    color: "#a0a0a0",
    cursor: "pointer",
    fontSize: 18,
    lineHeight: 1,
    padding: "0 4px",
    marginTop: -2,
  },
  scoreBar: {
    marginBottom: 14,
  },
  scoreBarLabel: {
    display: "block",
    color: "#c0c0c0",
    fontSize: 13,
    marginBottom: 4,
    fontWeight: 600,
  },
  scoreBarTrack: {
    height: 20,
    borderRadius: 10,
    background: "rgba(255,255,255,0.08)",
    overflow: "hidden",
  },
  scoreBarFill: {
    height: "100%",
    borderRadius: 10,
    minWidth: 8,
    transition: "width 0.25s ease",
  },
  infoIcon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 16,
    height: 16,
    borderRadius: "50%",
    border: "1px solid rgba(212, 175, 55, 0.6)",
    color: "#d4af37",
    fontSize: 11,
    fontWeight: 700,
    cursor: "help",
    marginLeft: 6,
    verticalAlign: "middle",
  },
  infoTooltip: {
    position: "absolute" as const,
    left: 0,
    top: "100%",
    marginTop: 4,
    padding: "8px 10px",
    background: "rgba(30, 30, 36, 0.98)",
    border: "1px solid rgba(212, 175, 55, 0.4)",
    borderRadius: 8,
    fontSize: 12,
    color: "#e0e0e0",
    maxWidth: 320,
    zIndex: 2147483647,
    boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
  },
  lowExplanation: {
    marginTop: 8,
    padding: "8px 10px",
    background: "rgba(244, 67, 54, 0.12)",
    border: "1px solid rgba(244, 67, 54, 0.4)",
    borderRadius: 8,
    fontSize: 12,
    color: "#e57373",
  },
  lowExplanationTitle: {
    fontWeight: 600,
    marginBottom: 4,
  },
  row: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 4,
  },
  label: { color: "#a0a0a0", fontSize: 13 },
  value: { fontWeight: 600, fontSize: 14 },
  loading: { color: "#888", fontSize: 14 },
  linkBtn: {
    marginTop: 10,
    padding: "6px 12px",
    background: "rgba(212, 175, 55, 0.2)",
    border: "1px solid rgba(212, 175, 55, 0.5)",
    borderRadius: 6,
    color: "#d4af37",
    cursor: "pointer",
    fontSize: 12,
  },
  ariadneSection: {
    marginTop: 12,
    paddingTop: 10,
    borderTop: "1px solid rgba(255,255,255,0.1)",
  },
  ariadneNode: {
    marginTop: 4,
    fontSize: 12,
    color: "#a0a0a0",
    wordBreak: "break-all" as const,
  },
  ariadneAlert: {
    marginTop: 4,
    fontSize: 12,
    color: "#b55",
  },
  section: {
    marginTop: 12,
    paddingTop: 10,
    borderTop: "1px solid rgba(255,255,255,0.1)",
  },
  chatMessages: {
    maxHeight: 160,
    overflow: "auto",
    marginBottom: 8,
    fontSize: 12,
  },
  chatBubble: {
    marginBottom: 6,
    padding: "6px 10px",
    borderRadius: 8,
    fontSize: 12,
  },
  chatInputRow: {
    display: "flex",
    gap: 6,
    marginTop: 4,
  },
  chatInput: {
    flex: 1,
    padding: "6px 10px",
    background: "rgba(255,255,255,0.08)",
    border: "1px solid rgba(212,175,55,0.4)",
    borderRadius: 6,
    color: "#e8e6e3",
    fontSize: 12,
  },
  chorusLink: {
    display: "block",
    marginTop: 6,
    fontSize: 12,
    color: "#d4af37",
    wordBreak: "break-all" as const,
  },
};

export interface ChorusLinkItem {
  label: string;
  url: string;
  perspective: string;
}

interface Props {
  loading: boolean;
  metrics: TextMetricsType | null;
  fromCache?: boolean;
  /** Specific explanation per low score (from backend). When present, shown instead of generic lowExplanation. */
  scoreExplanations?: Record<string, string>;
  pageUrl?: string;
  links?: string[];
  onAriadneLoad?: () => void;
  onClose?: () => void;
  /** Fetches Ariadne graph via background script (required for same-origin). Pass pageSummary for substantiation. */
  fetchAriadne?: (url: string, links: string[], pageSummary?: string) => Promise<AriadneResponse>;
  /** Oracle: chat with page. When provided, shows chat section. */
  pageText?: string;
  sessionId?: string;
  fetchChat?: (message: string) => Promise<string>;
  /** Chorus: alternative perspectives. When provided, shows "Other perspectives" and fetches links. */
  fetchChorus?: (url: string, topicOrSummary: string) => Promise<ChorusLinkItem[]>;
}

export function ShieldOverlay({
  loading,
  metrics,
  fromCache,
  scoreExplanations = {},
  pageUrl = "",
  links = [],
  onAriadneLoad,
  onClose,
  fetchAriadne,
  pageText,
  sessionId,
  fetchChat,
  fetchChorus,
}: Props) {
  const [ariadneOpen, setAriadneOpen] = useState(false);
  const [ariadneLoading, setAriadneLoading] = useState(false);
  const [ariadneData, setAriadneData] = useState<AriadneResponse | null>(null);
  const [chatMessages, setChatMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [chorusOpen, setChorusOpen] = useState(false);
  const [chorusLoading, setChorusLoading] = useState(false);
  const [chorusLinks, setChorusLinks] = useState<ChorusLinkItem[]>([]);

  const loadAriadne = () => {
    if (!pageUrl || ariadneData) {
      setAriadneOpen(true);
      return;
    }
    if (!fetchAriadne) {
      setAriadneOpen(true);
      return;
    }
    setAriadneLoading(true);
    setAriadneOpen(true);
    fetchAriadne(pageUrl, links, pageText?.slice(0, 1500))
      .then((data) => {
        setAriadneData(data);
        onAriadneLoad?.();
      })
      .catch(() => setAriadneData(null))
      .finally(() => setAriadneLoading(false));
  };

  const sendChat = () => {
    const msg = chatInput.trim();
    if (!msg || !fetchChat || chatSending) return;
    setChatInput("");
    setChatMessages((prev) => [...prev, { role: "user", content: msg }]);
    setChatSending(true);
    fetchChat(msg)
      .then((reply) => {
        setChatMessages((prev) => [...prev, { role: "assistant", content: reply }]);
      })
      .catch(() => {
        setChatMessages((prev) => [...prev, { role: "assistant", content: "Sorry, the request failed." }]);
      })
      .finally(() => setChatSending(false));
  };

  const loadChorus = () => {
    if (!fetchChorus || !pageUrl) return;
    setChorusOpen(true);
    setChorusLoading(true);
    // Pass page content (or URL) so backend can generate topic-relevant search queries
    const topicOrSummary = (pageText || "").trim().slice(0, 2000) || pageUrl;
    fetchChorus(pageUrl, topicOrSummary)
      .then(setChorusLinks)
      .catch(() => setChorusLinks([]))
      .finally(() => setChorusLoading(false));
  };

  const scoreItems: { key: ScoreKey; label: string; value: number }[] = metrics
    ? (["humanity", "integrity", "rhetoric"] as const).map((key) => ({
        key,
        label: SCORE_CONFIG[key].label,
        value: metrics[key],
      }))
    : [];

  const [infoOpen, setInfoOpen] = useState<ScoreKey | null>(null);
  const lowScores = metrics
    ? (["humanity", "integrity", "rhetoric"] as const).filter(
        (k) => metrics[k] < 34
      )
    : [];

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.title}>Odysseus Shield</div>
        {onClose && (
          <button
            type="button"
            style={styles.closeBtn}
            onClick={onClose}
            title="Close"
            aria-label="Close"
          >
            ×
          </button>
        )}
      </div>
      {loading && <div style={styles.loading}>Analyzing…</div>}
      {!loading && metrics && (
        <>
          <div style={{ marginBottom: 12 }}>
            {scoreItems.map(({ key, label, value }) => {
              const band = scoreColor(value);
              const colors = scoreBarColors[band];
              const config = SCORE_CONFIG[key];
              const showTooltip = infoOpen === key;
              return (
                <div
                  key={key}
                  style={{ ...styles.scoreBar, position: "relative" as const }}
                >
                  <span style={{ ...styles.scoreBarLabel, color: colors.text }}>
                    {label}
                    <span
                      style={styles.infoIcon}
                      onMouseEnter={() => setInfoOpen(key)}
                      onMouseLeave={() => setInfoOpen(null)}
                      title={config.description}
                    >
                      i
                    </span>
                    {showTooltip && (
                      <span
                        style={styles.infoTooltip}
                        onMouseEnter={() => setInfoOpen(key)}
                        onMouseLeave={() => setInfoOpen(null)}
                      >
                        {config.description}
                      </span>
                    )}
                  </span>
                  <div style={styles.scoreBarTrack}>
                    <div
                      style={{
                        ...styles.scoreBarFill,
                        width: `${Math.min(100, Math.max(0, value))}%`,
                        background: colors.border,
                      }}
                    />
                  </div>
                  <span style={{ ...styles.value, color: colors.text, marginTop: 2, display: "inline-block" }}>
                    {Math.round(value)}
                  </span>
                </div>
              );
            })}
          </div>
          {lowScores.length > 0 && (
            <div style={styles.lowExplanation}>
              <div style={styles.lowExplanationTitle}>Why these scores are low</div>
              {lowScores.map((key) => (
                <div key={key} style={{ marginTop: 4 }}>
                  <strong>{SCORE_CONFIG[key].label}:</strong>{" "}
                  {scoreExplanations[key] || SCORE_CONFIG[key].lowExplanation}
                </div>
              ))}
            </div>
          )}
          {fromCache && (
            <div style={{ ...styles.row, marginTop: 6, fontSize: 11, color: "#666" }}>
              From cache
            </div>
          )}
        </>
      )}
      {pageUrl && links.length > 0 && (
        <button style={styles.linkBtn} type="button" onClick={loadAriadne}>
          Link graph (Ariadne)
        </button>
      )}
      {ariadneOpen && (
        <div style={styles.ariadneSection}>
          <div style={styles.title}>Thread of Ariadne</div>
          {ariadneLoading && <div style={styles.loading}>Loading…</div>}
          {!ariadneLoading && ariadneData && (
            <>
              {ariadneData.substantiation_summary && (
                <div style={{ ...styles.ariadneNode, marginBottom: 8, color: "#c0c0c0", fontStyle: "italic" }}>
                  {ariadneData.substantiation_summary}
                </div>
              )}
              {ariadneData.alerts.length > 0 &&
                ariadneData.alerts.map((a, i) => (
                  <div key={i} style={styles.ariadneAlert}>
                    {a}
                  </div>
                ))}
              {ariadneData.nodes.slice(1, 15).map((n) => (
                <div key={n.id} style={styles.ariadneNode}>
                  <span style={{ color: n.type === "original_source" ? "#6b9b6b" : n.type === "broken" ? "#b55" : undefined }}>
                    [{n.type}]
                  </span>{" "}
                  {n.label}
                  {n.note && (
                    <span style={{ display: "block", fontSize: 11, color: "#888", marginTop: 2 }}>{n.note}</span>
                  )}
                </div>
              ))}
              {ariadneData.nodes.length > 15 && (
                <div style={styles.ariadneNode}>+{ariadneData.nodes.length - 15} more</div>
              )}
            </>
          )}
        </div>
      )}
      {fetchChat && pageText != null && sessionId && (
        <div style={styles.section}>
          <div style={styles.title}>Oracle – Chat with page</div>
          <div style={styles.chatMessages}>
            {chatMessages.map((m, i) => (
              <div
                key={i}
                style={{
                  ...styles.chatBubble,
                  background: m.role === "user" ? "rgba(212,175,55,0.2)" : "rgba(255,255,255,0.06)",
                  marginLeft: m.role === "assistant" ? 0 : 16,
                  marginRight: m.role === "user" ? 0 : 16,
                }}
              >
                {m.content}
              </div>
            ))}
          </div>
          <div style={styles.chatInputRow}>
            <input
              type="text"
              style={styles.chatInput}
              placeholder="Ask about this page…"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendChat()}
              disabled={chatSending}
            />
            <button type="button" style={styles.linkBtn} onClick={sendChat} disabled={chatSending}>
              {chatSending ? "…" : "Send"}
            </button>
          </div>
        </div>
      )}
      {fetchChorus && pageUrl && (
        <>
          <button style={styles.linkBtn} type="button" onClick={loadChorus}>
            Other perspectives (Chorus)
          </button>
          {chorusOpen && (
            <div style={styles.section}>
              <div style={styles.title}>Chorus</div>
              {chorusLoading && <div style={styles.loading}>Loading…</div>}
              {!chorusLoading && chorusLinks.length > 0 &&
                chorusLinks.map((link, i) => (
                  <a
                    key={i}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={styles.chorusLink}
                  >
                    {link.label}
                    {link.perspective ? ` (${link.perspective})` : ""}
                  </a>
                ))}
              {!chorusLoading && chorusLinks.length === 0 && chorusOpen && (
                <div style={styles.label}>No alternatives returned.</div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
