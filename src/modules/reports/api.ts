import type { ReportRecord, ReportResponse } from './types';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '').replace(/\/v1$/, '');
const reportsUrl = `${API_BASE}/reports`;

async function parseError(response: Response): Promise<string> {
  try {
    const data = await response.json();
    return data.message || data.detail || `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
}

export async function listReports(signal?: AbortSignal): Promise<ReportRecord[]> {
  const response = await fetch(reportsUrl, { credentials: 'include', signal });
  if (!response.ok) throw new Error(await parseError(response));
  const data = await response.json();
  return Array.isArray(data) ? data : data.reports;
}

export async function generateReport(analysisId: string, title: string): Promise<ReportResponse> {
  const response = await fetch(`${reportsUrl}/generate`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ analysis_id: analysisId.trim(), title: title.trim(), formats: ['pdf', 'csv', 'geojson'] }),
  });
  if (!response.ok) throw new Error(await parseError(response));
  return response.json();
}

export async function getReport(reportId: string): Promise<ReportResponse> {
  const response = await fetch(`${reportsUrl}/${encodeURIComponent(reportId)}`, { credentials: 'include' });
  if (!response.ok) throw new Error(await parseError(response));
  return response.json();
}

export async function downloadReportFile(reportId: string, format: 'pdf' | 'csv' | 'geojson'): Promise<Blob> {
  const response = await fetch(`${reportsUrl}/${encodeURIComponent(reportId)}/download?format=${format}`, { credentials: 'include' });
  if (!response.ok) throw new Error(await parseError(response));
  return response.blob();
}

export function saveDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
