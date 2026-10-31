import type { ReportRecord, ReportResponse } from './types';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '').replace(/\/v1$/, '');
const reportsUrl = `${API_BASE}/reports`;

function authHeaders(headers?: HeadersInit): HeadersInit {
  const token = window.localStorage.getItem('terramind_access_token');
  return { ...headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

async function parseError(response: Response): Promise<string> {
  try {
    const data = await response.json();
    return data.message || data.detail || `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
}

export async function listReports(signal?: AbortSignal): Promise<ReportRecord[]> {
  const response = await fetch(reportsUrl, { credentials: 'include', headers: authHeaders(), signal });
  if (!response.ok) throw new Error(await parseError(response));
  const data = await response.json();
  return Array.isArray(data) ? data : data.reports;
}

export async function generateReport(analysisId: string, title: string): Promise<ReportResponse> {
  const response = await fetch(`${reportsUrl}/generate`, {
    method: 'POST',
    credentials: 'include',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ analysis_id: analysisId.trim(), title: title.trim(), formats: ['pdf', 'csv'] }),
  });
  if (!response.ok) throw new Error(await parseError(response));
  return response.json();
}

export async function getReport(reportId: string): Promise<ReportResponse> {
  const response = await fetch(`${reportsUrl}/${encodeURIComponent(reportId)}`, { credentials: 'include', headers: authHeaders() });
  if (!response.ok) throw new Error(await parseError(response));
  return response.json();
}

export async function downloadReportFile(reportId: string, format: 'pdf' | 'csv' | 'geojson'): Promise<Blob> {
  const response = await fetch(`${reportsUrl}/${encodeURIComponent(reportId)}/download?format=${format}`, { credentials: 'include', headers: authHeaders() });
  if (!response.ok) throw new Error(await parseError(response));
  return response.blob();
}

export async function authenticate(email: string, password: string, register = false): Promise<void> {
  const response = await fetch(`${API_BASE}/auth/${register ? 'register' : 'token'}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new Error(await parseError(response));
  const body = await response.json();
  window.localStorage.setItem('terramind_access_token', body.access_token);
}

export function saveDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
