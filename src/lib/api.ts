/**
 * Shared backend API helpers for the TerraMind frontend.
 *
 * All fetchers use API_BASE and fail with human-readable errors instead of
 * the opaque `Failed to execute 'json' on 'Response'` SyntaxError.
 */

export const API_BASE = String(
  import.meta.env.VITE_API_BASE_URL || (import.meta.env.DEV ? 'http://localhost:8000/api' : '/api')
)
  .replace(/\/+$/, '')
  .replace(/\/v1$/, '');

export function bearerHeaders(headers?: HeadersInit): HeadersInit {
  const token = window.localStorage.getItem('terramind_access_token');
  return { ...headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

/** Read a JSON body, throwing a descriptive error for empty/non-JSON/invalid bodies. */
export async function readJson(response: Response): Promise<any> {
  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();
  if (!text.trim()) {
    throw new Error(`The backend API returned an empty response (HTTP ${response.status}).`);
  }
  if (!contentType.includes('application/json')) {
    throw new Error(
      `The backend API returned a non-JSON response (HTTP ${response.status}). ` +
      'Check that the API server is running and that VITE_API_BASE_URL points at it.'
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`The backend API returned invalid JSON (HTTP ${response.status}).`);
  }
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const isAbsolute = /^https?:\/\//i.test(path);
  // Backend-generated URLs (status_url, layer_url) already include the /api prefix.
  const normalizedPath = path.replace(/^\/api(?=\/|$)/, '');
  try {
    return await fetch(isAbsolute ? path : `${API_BASE}${normalizedPath}`, { ...init, headers: bearerHeaders(init.headers) });
  } catch (cause) {
    throw new Error(
      `Could not reach the backend API at ${API_BASE}. ` +
      (cause instanceof Error && cause.message ? `${cause.message} ` : '') +
      'Check that the API server is running and allows this origin (CORS).'
    );
  }
}

export async function apiRequest<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(bearerHeaders(init.headers));
  if (!headers.has('Content-Type') && typeof init.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }
  const response = await apiFetch(path, { ...init, headers });
  const data = await readJson(response);
  if (!response.ok) {
    throw new Error(data?.detail?.detail || data?.detail || data?.error || `Request failed (${response.status})`);
  }
  return data as T;
}
