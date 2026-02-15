/** Backend base URL. Change for production. */
export const API_BASE = "http://localhost:8000";

export interface TextMetrics {
  humanity: number;
  integrity: number;
  rhetoric: number;
}

export interface AnalyzeResponse {
  normalized_url: string;
  text_metrics: TextMetrics;
  media_metrics: Record<string, unknown>;
  from_cache: boolean;
  neutral_headline?: string;
  /** Excerpts that most contributed to low scores (metric -> list of exact quotes). */
  contributing_excerpts?: Record<string, string[]>;
  /** Specific explanation per low score: the argument/evidence that led to that score. */
  score_explanations?: Record<string, string>;
}

export interface AnalyzeRequest {
  url: string;
  text: string;
  media: string[];
}

export async function analyzePage(req: AnalyzeRequest): Promise<AnalyzeResponse> {
  const res = await fetch(`${API_BASE}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`Analyze failed: ${res.status}`);
  return res.json() as Promise<AnalyzeResponse>;
}

export interface LitmusResponse {
  verdict: string;
  explanation: string;
  from_cache: boolean;
}

export async function checkClaim(claim: string, pageUrl: string, context: string): Promise<LitmusResponse> {
  const res = await fetch(`${API_BASE}/api/litmus`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ claim, page_url: pageUrl, context }),
  });
  if (!res.ok) throw new Error(`Litmus failed: ${res.status}`);
  return res.json() as Promise<LitmusResponse>;
}

export interface AriadneNode {
  id: string;
  label: string;
  type: string;
  note?: string; // Substantiation note, e.g. "Primary source" or "Same outlet – verify elsewhere"
}

export interface AriadneEdge {
  source: string;
  target: string;
}

export interface AriadneResponse {
  normalized_url: string;
  nodes: AriadneNode[];
  edges: AriadneEdge[];
  alerts: string[];
  from_cache: boolean;
  substantiation_summary?: string;
}

export async function getAriadneGraph(
  url: string,
  links: string[],
  pageSummary?: string
): Promise<AriadneResponse> {
  const res = await fetch(`${API_BASE}/api/ariadne`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, links, page_summary: pageSummary || "" }),
  });
  if (!res.ok) throw new Error(`Ariadne failed: ${res.status}`);
  return res.json() as Promise<AriadneResponse>;
}
