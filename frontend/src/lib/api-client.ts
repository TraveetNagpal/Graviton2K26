import type { InvestigationResponse } from "../types/geospatial";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api";

export async function investigate(question: string, analysisId?: string): Promise<InvestigationResponse> {
  const response = await fetch(`${API_BASE}/ai/investigate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, ...(analysisId ? { analysis_id: analysisId } : {}) }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.detail?.detail ?? body.detail ?? `Investigation failed (${response.status})`);
  return body as InvestigationResponse;
}
