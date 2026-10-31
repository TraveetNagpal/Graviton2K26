import { useState, type FormEvent, type CSSProperties } from 'react';
import { useExplorerStore } from '@/store';
import type { MapLayer } from '@/types';
import { authenticate, downloadReportFile, generateReport, saveDownload } from '@/modules/reports/api';
import styles from './AnalysisWorkflow.module.css';

const API = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '').replace(/\/v1$/, '');
type Observation = { date: string; dataset: string; dataset_id: string; image_id: string; cloud_cover: number | null };
type LayerResult = { name: string; tile_url_template: string; visualization: { min: number; max: number; palette?: string[]; bands?: string[] } };
type JobAccepted = { analysis_id: string; status?: string; status_url?: string; layers_url?: string };

// Backend job URLs already include the /api mount; only prefix relative paths.
function resolveApiPath(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  if (path === '/api' || path.startsWith('/api/')) return path;
  return `${API}${path.startsWith('/') ? path : `/${path}`}`;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const token = window.localStorage.getItem('terramind_access_token');
  const headers = new Headers(init?.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const retryable = !init?.method || init.method === 'GET';
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, { ...init, headers });
    if (retryable && [429, 502, 503, 504].includes(response.status) && attempt < 2) {
      await new Promise(resolve => setTimeout(resolve, 800 * (attempt + 1)));
      continue;
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.detail?.detail || body.detail || body.error?.detail || body.error || `Request failed (${response.status})`);
    return body as T;
  }
}

export default function AnalysisWorkflow() {
  const selection = useExplorerStore(s => s.activeSelection);
  const setAnalysisLayers = useExplorerStore(s => s.setAnalysisLayers);
  const [start, setStart] = useState('2025-01-01');
  const [end, setEnd] = useState('2026-01-01');
  const [dataset, setDataset] = useState('sentinel-2');
  const [cloud, setCloud] = useState('30');
  const [observations, setObservations] = useState<Observation[]>([]);
  const [earlier, setEarlier] = useState('');
  const [later, setLater] = useState('');
  const [analysisId, setAnalysisId] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [question, setQuestion] = useState('How has vegetation changed?');
  const [interpretation, setInterpretation] = useState('');
  const [signedIn, setSignedIn] = useState(() => Boolean(window.localStorage.getItem('terramind_access_token')));
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [registering, setRegistering] = useState(false);

  const geometry = selection?.geometry;
  const canSearch = geometry?.type === 'Polygon' && Boolean(start) && Boolean(end) && end > start;

  function reportError(e: unknown, fallback: string) {
    const message = e instanceof Error ? e.message : fallback;
    setError(message);
    if (/bearer token|invalid or expired/i.test(message)) setSignedIn(false);
    return message;
  }

  async function onSignIn(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      await authenticate(authEmail.trim(), authPassword, registering);
      setSignedIn(true); setAuthPassword('');
      setStatus(registering ? 'Account created. Search the catalog to begin.' : 'Signed in. Search the catalog to begin.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed.');
    } finally { setBusy(false); }
  }

  async function onSearch(event: FormEvent) {
    event.preventDefault(); setError(''); setObservations([]); setAnalysisId(''); setStatus('Searching Earth Engine catalog…');
    if (!canSearch || !selection) { setError('Draw a polygon selection and choose an end date later than the start date.'); return; }
    setBusy(true);
    try {
      const response = await request<{ observations: Observation[] }>(`${API}/satellite/search`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ area_of_interest: selection.geometry, start_date: start, end_date: end, dataset, max_cloud_cover: Number(cloud) }) });
      const ordered = [...response.observations].sort((a, b) => a.date.localeCompare(b.date));
      setObservations(ordered);
      if (ordered.length >= 2) { setEarlier(ordered[0].image_id); setLater(ordered[ordered.length - 1].image_id); }
      setStatus(ordered.length ? `${ordered.length} real catalog observations found.` : 'No matching imagery in this region and date range.');
    } catch (e) { reportError(e, 'Satellite search failed.'); setStatus(''); }
    finally { setBusy(false); }
  }

  async function onAnalyze(event: FormEvent) {
    event.preventDefault();
    const first = observations.find(o => o.image_id === earlier); const second = observations.find(o => o.image_id === later);
    if (!selection || !first || !second || first.date >= second.date) { setError('Select two returned observations in chronological order.'); return; }
    setBusy(true); setError(''); setStatus('Submitting vegetation analysis…');
    try {
      const accepted = await request<JobAccepted>(`${API}/analysis/vegetation`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ earlier_image_id: first.image_id, earlier_dataset: first.dataset, later_image_id: second.image_id, later_dataset: second.dataset, area_of_interest: selection.geometry }) });
      setAnalysisId(accepted.analysis_id);

      // Serverless deployments run inline and return status "completed"; other
      // deployments return 202 and need polling.
      if (accepted.status !== 'completed') {
        setStatus(`Analysis ${accepted.analysis_id} accepted. Waiting for Earth Engine…`);
        const statusUrl = resolveApiPath(accepted.status_url ?? `/analysis/${accepted.analysis_id}`);
        let completed = false;
        for (let i = 0; i < 180; i++) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          const job = await request<{ status: string; error?: { detail?: string } }>(statusUrl);
          if (job.status === 'failed') throw new Error(job.error?.detail || 'Earth Engine analysis failed.');
          if (job.status === 'completed') { completed = true; break; }
        }
        if (!completed) throw new Error('Analysis is still processing. Its ID is saved above; retry by refreshing status in the API.');
      }

      setStatus('Analysis completed. Loading change layers…');
      try {
        const layerResponse = await request<{ layers: LayerResult[] }>(resolveApiPath(accepted.layers_url ?? `/analysis/${accepted.analysis_id}/layers`));
        const layers: MapLayer[] = layerResponse.layers.map((layer, index) => ({
          id: `analysis-${accepted.analysis_id}-${layer.name}`, name: layer.name.replace(/_/g, ' '), category: 'change', type: 'xyz', visible: index === 0, opacity: 0.75,
          url: layer.tile_url_template,
          legend: (layer.visualization.palette || []).map((color, n) => ({ color, label: index === 0 ? `${(layer.visualization.min + (layer.visualization.max - layer.visualization.min) * n / Math.max(1, (layer.visualization.palette || []).length - 1)).toFixed(2)} NDVI change` : `Index ${n + 1}` })),
        }));
        setAnalysisLayers(layers);
        setStatus('Analysis completed. Backend measurements and change layers are displayed on the map.');
      } catch {
        setStatus('Analysis completed. Map layers are unavailable on this server instance, but measurements are saved.');
      }
    } catch (e) { reportError(e, 'Analysis failed. No result layer was added.'); setStatus(''); }
    finally { setBusy(false); }
  }

  async function onExplain(event: FormEvent) {
    event.preventDefault(); if (!analysisId) return;
    setBusy(true); setError('');
    try {
      const result = await request<{ finding?: string; interpretation?: string; limitations?: string[] }>(`${API}/ai/investigate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question, analysis_id: analysisId }) });
      setInterpretation([result.finding, result.interpretation, ...(result.limitations || [])].filter(Boolean).join('\n\n'));
    } catch (e) { reportError(e, 'Investigation request failed.'); }
    finally { setBusy(false); }
  }

  async function onReport() {
    if (!analysisId) return;
    setBusy(true); setError('');
    try { const generated = await generateReport(analysisId, 'Vegetation change analysis'); saveDownload(await downloadReportFile(generated.report.id, 'pdf'), `${generated.report.id}.pdf`); }
    catch (e) { reportError(e, 'Report generation/download failed. Sign in from Reports and retry.'); }
    finally { setBusy(false); }
  }

  return <aside className={styles.panel} aria-label="Satellite analysis workflow">
    <strong style={{ fontSize: 14 }}>Satellite change analysis</strong>
    <p style={{ color: '#a2a5ab', margin: '4px 0 10px' }}>{selection ? 'Selected geometry is sent as WGS84 GeoJSON.' : 'Draw a polygon on the map to begin.'}</p>

    {!signedIn && <form onSubmit={onSignIn} style={{ display: 'grid', gap: 7, paddingBottom: 10, marginBottom: 10, borderBottom: '1px solid rgba(255,255,255,.14)' }}>
      <p style={{ margin: 0, color: '#e6c17a' }}>{registering ? 'Create an account (password 12+ characters) to run analyses.' : 'Sign in to run satellite analyses.'}</p>
      <input type="email" required autoComplete="email" placeholder="Email address" value={authEmail} onChange={e => setAuthEmail(e.target.value)} style={field} />
      <input type="password" required minLength={12} autoComplete={registering ? 'new-password' : 'current-password'} placeholder="Password (12+ characters)" value={authPassword} onChange={e => setAuthPassword(e.target.value)} style={field} />
      <button disabled={busy} style={button}>{busy ? 'Working…' : registering ? 'Create account and sign in' : 'Sign in'}</button>
      <button type="button" onClick={() => setRegistering(v => !v)} style={linkButton}>{registering ? 'Already have an account? Sign in' : 'New here? Create an account'}</button>
    </form>}

    <form onSubmit={onSearch} style={{ display: 'grid', gap: 8 }}>
      <label>Dataset<select value={dataset} onChange={e => setDataset(e.target.value)} style={field}><option value="sentinel-2">Sentinel-2</option><option value="landsat-8">Landsat 8</option><option value="landsat-9">Landsat 9</option><option value="landsat">Landsat (all)</option></select></label>
      <div style={{ display: 'flex', gap: 7 }}><label>Start<input type="date" value={start} onChange={e => setStart(e.target.value)} style={field}/></label><label>End (exclusive)<input type="date" value={end} onChange={e => setEnd(e.target.value)} style={field}/></label></div>
      <label>Maximum scene cloud cover (%)<input type="number" min="0" max="100" value={cloud} onChange={e => setCloud(e.target.value)} style={field}/></label>
      <button disabled={busy || !canSearch} style={button}>{busy ? 'Working…' : 'Search real observations'}</button>
      {!canSearch && <small style={{ color: '#a2a5ab' }}>Draw a polygon or rectangle, then choose a valid date range to enable search.</small>}
    </form>

    {status && <p role="status" style={{ color: '#8fbaff', marginTop: 9, overflowWrap: 'anywhere' }}>{status}</p>}
    {error && <p role="alert" style={{ color: '#e88989', marginTop: 8 }}>{error}</p>}
    {analysisId && <small style={{ color: '#a2a5ab' }}>Analysis ID: {analysisId}</small>}

    {observations.length > 0 && <form onSubmit={onAnalyze} style={{ display: 'grid', gap: 7, marginTop: 11, borderTop: '1px solid rgba(255,255,255,.14)', paddingTop: 10 }}><label>Earlier observation<select value={earlier} onChange={e => setEarlier(e.target.value)} style={field}>{observations.map(o => <option key={o.image_id} value={o.image_id}>{o.date} · {o.cloud_cover == null ? 'cloud n/a' : `${o.cloud_cover}% cloud`}</option>)}</select></label><label>Later observation<select value={later} onChange={e => setLater(e.target.value)} style={field}>{observations.map(o => <option key={o.image_id} value={o.image_id}>{o.date} · {o.cloud_cover == null ? 'cloud n/a' : `${o.cloud_cover}% cloud`}</option>)}</select></label><button disabled={busy || observations.length < 2} style={button}>{busy ? 'Working…' : 'Run vegetation analysis'}</button>{observations.length < 2 && <small style={{ color: '#e6c17a' }}>At least two observations are required. Widen the date range or raise the cloud limit.</small>}{!signedIn && <small style={{ color: '#e6c17a' }}>Sign in above to run the analysis.</small>}</form>}

    {analysisId && !busy && status.startsWith('Analysis completed') && <div style={{ borderTop: '1px solid rgba(255,255,255,.14)', marginTop: 10, paddingTop: 10, display: 'grid', gap: 7 }}><form onSubmit={onExplain} style={{ display: 'grid', gap: 6 }}><label>Ask the investigator<input value={question} onChange={e => setQuestion(e.target.value)} style={field}/></label><button style={button}>Explain measured results</button></form>{interpretation && <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5, color: '#c4c7cc' }}>{interpretation}</p>}<button type="button" onClick={() => void onReport()} style={button}>Generate and download PDF</button></div>}
  </aside>;
}

const field: CSSProperties = { display: 'block', width: '100%', marginTop: 3, padding: 6, borderRadius: 2, border: '1px solid rgba(255,255,255,.16)', background: '#0a0c0f', color: '#f3f3ef', fontSize: 11 };
const button: CSSProperties = { padding: '8px 10px', border: 0, borderRadius: 2, background: '#6fa8ff', color: '#05101f', fontWeight: 600, cursor: 'pointer' };
const linkButton: CSSProperties = { padding: 0, border: 0, background: 'transparent', color: '#8fbaff', cursor: 'pointer', fontSize: 11, textAlign: 'left' };
