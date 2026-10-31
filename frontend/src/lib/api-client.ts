import type { InvestigationResponse } from "../types/geospatial";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api";

function authHeaders(): HeadersInit {
  const token = typeof window !== "undefined" ? window.localStorage.getItem("terramind_access_token") : null;
  return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

export async function investigate(question: string, analysisId?: string): Promise<InvestigationResponse> {
  const response = await fetch(`${API_BASE}/ai/investigate`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ question, ...(analysisId ? { analysis_id: analysisId } : {}) }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.detail?.detail ?? body.detail ?? `Investigation failed (${response.status})`);
  return body as InvestigationResponse;
}
