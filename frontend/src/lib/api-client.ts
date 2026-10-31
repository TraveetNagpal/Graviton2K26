import type { HistoricalTrend, InvestigationResponse, SatelliteObservation, TileLayer } from "../types/geospatial";

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

async function request<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.detail?.detail ?? result.detail ?? result.error ?? `Request failed (${response.status})`);
  return result as T;
}

export const searchSatellite = (params: Record<string, unknown>) => request<{ observations: SatelliteObservation[]; processing: Record<string, unknown> }>("/satellite/search", params);
export const previewSatellite = (params: Record<string, unknown>) => request<{ metadata: Record<string, unknown>; layer: { tile_url_template: string } }>("/satellite/preview", params);
export const startHistoricalTrend = (params: Record<string, unknown>) => request<{ analysis_id: string; status: string; status_url: string; cached_or_in_progress: boolean }>("/analysis/trend", params);
export const getHistoricalTrend = async (id: string): Promise<HistoricalTrend> => {
  const response = await fetch(`${API_BASE}/analysis/${id}`);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.detail ?? `Could not read analysis status (${response.status})`);
  return result as HistoricalTrend;
};
export const getAnalysisLayers = async (url: string): Promise<TileLayer[]> => {
  const root = API_BASE.replace(/\/api\/?$/, "");
  const response = await fetch(`${root}${url}`);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.detail ?? "Could not load map layers");
  return result.layers as TileLayer[];
};
