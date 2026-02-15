import React, { useState } from "react";
import type { TextMetrics as TextMetricsType, AriadneResponse } from "../shared/api";

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: "fixed",
    top: 12,
    right: 12,
    zIndex: 2147483647,
    fontFamily: "system-ui, sans-serif",
    fontSize: 12,
    background: "rgba(20, 20, 24, 0.95)",
    color: "#e8e6e3",
    padding: "10px 14px",
    borderRadius: 8,
    boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
    border: "1px solid rgba(212, 175, 55, 0.4)",
    minWidth: 160,
    maxWidth: 320,
    maxHeight: "80vh",
    overflow: "auto",
  },
  title: {
    marginBottom: 8,
    fontWeight: 600,
    color: "#d4af37",
  },
  row: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 4,
  },
  label: { color: "#a0a0a0" },
  value: { fontWeight: 500 },
  loading: { color: "#888" },
  linkBtn: {
    marginTop: 8,
    padding: "4px 8px",
    background: "rgba(212, 175, 55, 0.2)",
    border: "1px solid rgba(212, 175, 55, 0.5)",
    borderRadius: 4,
    color: "#d4af37",
    cursor: "pointer",
    fontSize: 11,
  },
  ariadneSection: {
    marginTop: 10,
    paddingTop: 8,
    borderTop: "1px solid rgba(255,255,255,0.1)",
  },
  ariadneNode: {
    marginTop: 4,
    fontSize: 11,
    color: "#a0a0a0",
    wordBreak: "break-all" as const,
  },
  ariadneAlert: {
    marginTop: 4,
    fontSize: 11,
    color: "#b55",
  },
};

interface Props {
  loading: boolean;
  metrics: TextMetricsType | null;
  fromCache?: boolean;
  pageUrl?: string;
  links?: string[];
  onAriadneLoad?: () => void;
  /** Fetches Ariadne graph via background script (required for same-origin). */
  fetchAriadne?: (url: string, links: string[]) => Promise<AriadneResponse>;
}

export function ShieldOverlay({
  loading,
  metrics,
  fromCache,
  pageUrl = "",
  links = [],
  onAriadneLoad,
  fetchAriadne,
}: Props) {
  const [ariadneOpen, setAriadneOpen] = useState(false);
  const [ariadneLoading, setAriadneLoading] = useState(false);
  const [ariadneData, setAriadneData] = useState<AriadneResponse | null>(null);

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
    fetchAriadne(pageUrl, links)
      .then((data) => {
        setAriadneData(data);
        onAriadneLoad?.();
      })
      .catch(() => setAriadneData(null))
      .finally(() => setAriadneLoading(false));
  };

  return (
    <div style={styles.container}>
      <div style={styles.title}>Odysseus Shield</div>
      {loading && <div style={styles.loading}>Analyzing…</div>}
      {!loading && metrics && (
        <>
          <div style={styles.row}>
            <span style={styles.label}>Humanity</span>
            <span style={styles.value}>{Math.round(metrics.humanity)}</span>
          </div>
          <div style={styles.row}>
            <span style={styles.label}>Integrity</span>
            <span style={styles.value}>{Math.round(metrics.integrity)}</span>
          </div>
          <div style={styles.row}>
            <span style={styles.label}>Rhetoric</span>
            <span style={styles.value}>{Math.round(metrics.rhetoric)}</span>
          </div>
          {fromCache && (
            <div style={{ ...styles.row, marginTop: 6, fontSize: 10, color: "#666" }}>
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
                </div>
              ))}
              {ariadneData.nodes.length > 15 && (
                <div style={styles.ariadneNode}>+{ariadneData.nodes.length - 15} more</div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
