import { apiFetch, readJson } from '@/lib/api';
import type { ReportRecord, ReportResponse } from './types';

async function parseError(response: Response): Promise<string> {
  try {
    const data = await readJson(response);
    return data?.message || data?.detail?.detail || data?.detail || data?.error || `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
}

async function readOkJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(await parseError(response));
  return (await readJson(response)) as T;
}

export async function listReports(signal?: AbortSignal): Promise<ReportRecord[]> {
  const response = await apiFetch('/reports', { signal });
  const data = await readOkJson<ReportRecord[] | { reports: ReportRecord[] }>(response);
  return Array.isArray(data) ? data : data.reports;
}

export async function generateReport(analysisId: string, title: string): Promise<ReportResponse> {
  const response = await apiFetch('/reports/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ analysis_id: analysisId.trim(), title: title.trim(), formats: ['pdf', 'csv'] }),
  });
  return readOkJson<ReportResponse>(response);
}

export async function getReport(reportId: string): Promise<ReportResponse> {
  const response = await apiFetch(`/reports/${encodeURIComponent(reportId)}`);
  return readOkJson<ReportResponse>(response);
}

export async function downloadReportFile(reportId: string, format: 'pdf' | 'csv' | 'geojson'): Promise<Blob> {
  const response = await apiFetch(`/reports/${encodeURIComponent(reportId)}/download?format=${format}`);
  if (!response.ok) throw new Error(await parseError(response));
  return response.blob();
}

export function saveDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
