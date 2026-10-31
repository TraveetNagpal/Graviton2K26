
import { useEffect, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';

const API = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api').replace(/\/$/, '').replace(/\/v1$/, '');

export default function Dashboard() {
  const [service, setService] = useState('checking');
  const [earthEngine, setEarthEngine] = useState('checking');
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API.replace(/\/api$/, '')}/health`, { signal: controller.signal }).then(r => setService(r.ok ? 'available' : 'unavailable')).catch(() => setService('unavailable'));
    fetch(`${API}/earth-engine/status`, { signal: controller.signal }).then(r => r.json()).then(v => setEarthEngine(v.authenticated ? 'authenticated' : 'not configured')).catch(() => setEarthEngine('unavailable'));
    return () => controller.abort();
  }, []);
  return <main style={{ height: '100%', overflow: 'auto', padding: 'clamp(24px, 6vw, 72px)', color: 'var(--color-text)', maxWidth: 1280, margin: 'auto' }}>
    <p style={{ color: 'var(--color-primary)', fontSize: 10, fontWeight: 700, letterSpacing: '.17em' }}>TERRAMIND AI · EARTH OBSERVATION</p>
    <h1 style={{ marginTop: 10, fontSize: 'clamp(30px, 5vw, 50px)', letterSpacing: '-.04em' }}>See what changed on Earth.</h1>
    <p style={{ maxWidth: 620, color: 'var(--color-text-muted)', marginTop: 12, lineHeight: 1.7 }}>Compare real Sentinel-2 and Landsat observations, map measured vegetation change, and ask the investigator to explain results using the underlying analysis evidence.</p>
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 28 }}><Link to="/explorer" style={primary}>Open satellite explorer →</Link><Link to="/reports" style={secondary}>Reports and exports</Link></div>
    <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12, marginTop: 42 }}>
      <Status title="Analysis API" value={service}/><Status title="Earth Engine" value={earthEngine}/><Status title="Data handling" value="Backend measurements · WGS84"/>
    </section>
    <section style={{ marginTop: 38, padding: 20, border: '1px solid var(--color-border-subtle)', background: 'var(--color-surface)', borderRadius: 10 }}><h2 style={{ fontSize: 16 }}>Workflow</h2><ol style={{ paddingLeft: 20, marginTop: 10, color: 'var(--color-text-muted)', lineHeight: 2 }}><li>Sign in from Reports to access private analysis workflows.</li><li>Draw a polygon and search the satellite catalog for two dates.</li><li>Run vegetation analysis and review its change layer and coverage.</li><li>Ask the investigator or generate a traceable PDF report.</li></ol></section>
  </main>;
}

function Status({ title, value }: { title: string; value: string }) {
  const color = value === 'available' || value === 'authenticated' ? 'var(--color-success)' : value === 'checking' ? 'var(--color-warning)' : 'var(--color-text-muted)';
  return <article style={{ padding: 16, border: '1px solid var(--color-border-subtle)', background: 'var(--color-surface)', borderRadius: 8 }}><small style={{ color: 'var(--color-text-dim)' }}>{title}</small><div style={{ marginTop: 5, color, textTransform: 'capitalize', fontWeight: 600 }}>{value}</div></article>;
}
const primary: CSSProperties = { background: 'var(--color-primary)', color: '#082f49', padding: '11px 15px', borderRadius: 5, fontWeight: 700, textDecoration: 'none' };
const secondary: CSSProperties = { background: 'var(--color-surface-2)', color: 'var(--color-text)', padding: '11px 15px', border: '1px solid var(--color-border)', borderRadius: 5, textDecoration: 'none' };

import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useExplorerStore } from '@/store';

const API = String((import.meta as any).env?.VITE_API_BASE_URL || 'http://localhost:8000/api').replace(/\/$/, '');
type Monitor = { id: string; name: string; status: string; next_run_at: string; last_success_at?: string; baseline_date?: string; consecutive_failures: number; config: any };
type Alert = { id: string; category: string; region_name: string; observation_date: string; baseline_date?: string; dataset?: string; valid_pixel_coverage_percent?: number; processed_at?: string; created_at: string; summary: string; measurement: { metric: string; value: number; unit: string; value_hectares?: number }; layer_url?: string; verification_status: string };

const defaults = {
  name: '', purpose: 'Track change over time', dataset: 'sentinel-2', analysis_type: 'vegetation',
  detection_threshold: 0.1, schedule_interval_minutes: 1440, max_cloud_cover: 40,
  minimum_valid_coverage_percent: 20, notifications: { in_app: true, email: false },
};

async function request(path: string, init: RequestInit = {}) {
  const response = await fetch(`${API}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers || {}) } });
  if (response.status === 204) return null;
  const data = await response.json();
  if (!response.ok) throw new Error(data.detail?.detail || data.detail || data.error || `Request failed (${response.status})`);
  return data;
}

export default function Dashboard() {
  const selected = useExplorerStore(s => s.activeSelection);
  const showAnalysisLayer = useExplorerStore(s => s.showAnalysisLayer);
  const navigate = useNavigate();
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [runLogs, setRunLogs] = useState<Record<string, any[]>>({});
  const [form, setForm] = useState<any>(defaults);
  const [boundary, setBoundary] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function refresh() {
    try {
      const [m, a] = await Promise.all([request('/monitoring'), request('/monitoring/alerts')]);
      setMonitors(m.monitors); setAlerts(a.alerts);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load monitoring data.'); }
  }
  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 30000); return () => window.clearInterval(timer); }, []);
  useEffect(() => { if (selected?.geometry) setBoundary(JSON.stringify(selected.geometry, null, 2)); }, [selected]);

  function startEdit(item: Monitor) {
    setEditing(item.id); setForm({ ...item.config, notifications: { in_app: true, email: false, ...(item.config.notifications || {}) } });
    setBoundary(JSON.stringify(item.config.area_of_interest, null, 2));
  }
  function resetForm() { setEditing(null); setForm(defaults); setBoundary(selected?.geometry ? JSON.stringify(selected.geometry, null, 2) : ''); }
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      const payload = { ...form, area_of_interest: JSON.parse(boundary) };
      if (editing) await request(`/monitoring/${editing}`, { method: 'PUT', body: JSON.stringify(payload) });
      else await request('/monitoring', { method: 'POST', body: JSON.stringify(payload) });
      setMessage(editing ? 'Monitoring configuration updated.' : 'Monitoring configuration saved. Its first run will establish an actual satellite observation as the baseline.');
      resetForm(); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save monitoring configuration.'); }
    finally { setBusy(false); }
  }
  async function act(path: string, method = 'POST') {
    setError('');
    try { await request(path, { method }); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Action failed.'); }
  }
  async function loadRuns(monitorId: string) {
    try { const result = await request(`/monitoring/${monitorId}/runs`); setRunLogs(current => ({ ...current, [monitorId]: result.runs })); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load processing log.'); }
  }
  async function updateAlert(id: string, status: string) { try { await request(`/monitoring/alerts/${id}`, { method: 'PATCH', body: JSON.stringify({ verification_status: status }) }); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not update alert.'); } }
  async function openAlertLayer(alert: Alert) {
    if (!alert.layer_url) return;
    try {
      const root = API.replace(/\/api\/?$/, '');
      const response = await fetch(`${root}${alert.layer_url}`);
      const data = await response.json();
      if (!response.ok || !data.layers?.[0]?.tile_url_template) throw new Error(data.detail?.detail || 'Map layer is unavailable.');
      const layerId = alert.category.indexOf('vegetation') >= 0 ? 'vegetation-ndvi' : alert.category.indexOf('water') >= 0 ? 'water-analysis' : 'urban-change';
      showAnalysisLayer(layerId, data.layers.find((layer: any) => layer.name === 'change')?.tile_url_template || data.layers[0].tile_url_template);
      navigate('/explorer');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load the supporting map layer.'); }
  }

  return <div style={{ height: '100%', overflow: 'auto', padding: '26px clamp(16px, 4vw, 48px)', color: 'var(--color-text)' }}>
    <header style={{ marginBottom: 22 }}><p style={{ color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: 2, fontSize: 11 }}>TerraMind · Module 8</p><h1 style={{ fontSize: 28, margin: '4px 0' }}>Regional monitoring</h1><p style={{ color: 'var(--color-text-muted)' }}>Scheduled runs look for newly available satellite scenes, then compare numerical measurements. Alerts represent potential changes for review.</p></header>
    {message && <p role="status" style={{ color: 'var(--color-success)', marginBottom: 12 }}>{message}</p>}{error && <p role="alert" style={{ color: 'var(--color-error)', marginBottom: 12 }}>{error}</p>}
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(290px, 0.85fr) minmax(360px, 1.4fr)', gap: 22, alignItems: 'start' }}>
      <section style={card}><h2 style={h2}>{editing ? 'Edit monitoring configuration' : 'Create a monitoring region'}</h2><p style={hint}>Draw a polygon in Earth Explorer, then copy it here, or paste a WGS84 GeoJSON Polygon.</p>
        <form onSubmit={save}>
          <label style={label}>Region name<input style={input} required maxLength={120} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
          <label style={label}>Monitoring purpose<input style={input} required value={form.purpose} onChange={e => setForm({ ...form, purpose: e.target.value })} /></label>
          <label style={label}>Boundary · GeoJSON<textarea style={{ ...input, minHeight: 120, fontFamily: 'monospace', fontSize: 11 }} required value={boundary} onChange={e => setBoundary(e.target.value)} placeholder="Select a region in the Explorer, or paste a Polygon" /></label>
          <div style={row}><label style={label}>Dataset<select style={input} value={form.dataset} onChange={e => setForm({ ...form, dataset: e.target.value })}><option value="sentinel-2">Sentinel-2 SR</option><option value="landsat">Landsat 8 + 9</option><option value="landsat-8">Landsat 8</option><option value="landsat-9">Landsat 9</option></select></label><label style={label}>Analysis<select style={input} value={form.analysis_type} onChange={e => setForm({ ...form, analysis_type: e.target.value })}><option value="vegetation">Vegetation · NDVI</option><option value="water">Water · NDWI</option><option value="urban">Built-up proxy · NDBI</option></select></label></div>
          <div style={row}><label style={label}>Threshold {form.analysis_type === 'vegetation' ? '(NDVI decrease)' : '(hectares)'}<input style={input} type="number" min="0.001" step="0.01" value={form.detection_threshold} onChange={e => setForm({ ...form, detection_threshold: Number(e.target.value) })} /></label><label style={label}>Interval · minutes<input style={input} type="number" min="15" max="43200" step="15" value={form.schedule_interval_minutes} onChange={e => setForm({ ...form, schedule_interval_minutes: Number(e.target.value) })} /></label></div>
          <div style={row}><label style={label}>Max scene cloud %<input style={input} type="number" min="0" max="100" value={form.max_cloud_cover} onChange={e => setForm({ ...form, max_cloud_cover: Number(e.target.value) })} /></label><label style={label}>Minimum valid AOI %<input style={input} type="number" min="1" max="100" value={form.minimum_valid_coverage_percent} onChange={e => setForm({ ...form, minimum_valid_coverage_percent: Number(e.target.value) })} /></label></div>
          <label style={{ ...label, display: 'flex', alignItems: 'center', gap: 8 }}><input type="checkbox" checked={form.notifications.in_app} onChange={e => setForm({ ...form, notifications: { ...form.notifications, in_app: e.target.checked } })} />In-app notifications</label>
          <label style={{ ...label, display: 'flex', alignItems: 'center', gap: 8 }}><input type="checkbox" checked={form.notifications.email} onChange={e => setForm({ ...form, notifications: { ...form.notifications, email: e.target.checked } })} />Email alerts (sent only when backend SMTP is configured)</label>
          {form.notifications.email && <label style={label}>Email recipient<input style={input} type="email" required value={form.notifications.email_to || ''} onChange={e => setForm({ ...form, notifications: { ...form.notifications, email_to: e.target.value } })} /></label>}
          <button style={button} disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Create monitoring region'}</button>{editing && <button type="button" style={secondary} onClick={resetForm}>Cancel edit</button>}
        </form>
      </section>
      <section><h2 style={h2}>Saved regions · {monitors.filter(m => m.status === 'active').length} active</h2>{monitors.length === 0 ? <p style={card}>No monitoring regions yet. Create one to begin.</p> : monitors.map(m => <article key={m.id} style={{ ...card, marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'start' }}><div><h3 style={{ fontSize: 16 }}>{m.name} <span style={{ color: m.status === 'active' ? 'var(--color-success)' : 'var(--color-text-muted)', fontSize: 12 }}>· {m.status}</span></h3><p style={hint}>{m.config.purpose}</p></div><span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{m.config.analysis_type} · {m.config.dataset}</span></div>
        <p style={hint}>Baseline: {m.baseline_date || 'Waiting for first eligible scene'} · Last successful run: {m.last_success_at ? new Date(m.last_success_at).toLocaleString() : 'None'}{m.consecutive_failures > 0 ? ` · ${m.consecutive_failures} failed attempts` : ''}</p>
        <p style={hint}>Next check: {new Date(m.next_run_at).toLocaleString()} · every {m.config.schedule_interval_minutes} min</p>
        <div style={actions}><button style={smallButton} onClick={() => startEdit(m)}>Edit</button><button style={smallButton} onClick={() => void act(`/monitoring/${m.id}/${m.status === 'active' ? 'pause' : 'resume'}`)}>{m.status === 'active' ? 'Pause' : 'Resume'}</button><button style={smallButton} onClick={() => void act(`/monitoring/${m.id}/run`)}>Run check</button><button style={smallButton} onClick={() => void loadRuns(m.id)}>View run log</button><button style={danger} onClick={() => { if (window.confirm(`Delete ${m.name} and its monitoring history?`)) void act(`/monitoring/${m.id}`, 'DELETE'); }}>Delete</button></div>
        {runLogs[m.id] && <div style={{ marginTop: 10, borderTop: '1px solid var(--color-border-subtle)', paddingTop: 8 }}><strong style={{ fontSize: 12 }}>Recent processing attempts</strong>{runLogs[m.id].length === 0 ? <p style={hint}>No runs recorded.</p> : runLogs[m.id].slice(0, 5).map(run => <p key={run.id} style={hint}>{run.status} · {new Date(run.started_at).toLocaleString()} · {run.error?.detail || run.result?.message || run.result?.analysis_id || 'No new scene or baseline initialized'}</p>)}</div>}
      </article>)}</section>
    </div>
    <section style={{ marginTop: 28 }}><h2 style={h2}>Potential change alerts · {alerts.filter(a => a.verification_status === 'pending').length} to review</h2>{alerts.length === 0 ? <p style={card}>No alerts yet. A scheduled run first establishes a baseline; later runs require a new usable observation.</p> : alerts.map(a => <article key={a.id} style={{ ...card, marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><div><strong>{a.category.split('_').join(' ')}</strong><p style={hint}>{a.region_name} · compared {a.baseline_date || 'baseline'} → {a.observation_date} · {a.dataset || 'dataset unavailable'} · processed {new Date(a.processed_at || a.created_at).toLocaleString()}</p><p style={hint}>AOI valid-pixel coverage: {typeof a.valid_pixel_coverage_percent === 'number' ? `${a.valid_pixel_coverage_percent.toFixed(1)}%` : 'unavailable'}</p></div><span style={{ color: a.verification_status === 'pending' ? 'var(--color-warning)' : 'var(--color-success)' }}>{a.verification_status}</span></div>
      <p>{a.summary}</p><p style={hint}>Measured {a.measurement.metric}: {typeof a.measurement.value === 'number' ? `${a.measurement.value.toFixed(3)} ${a.measurement.unit}` : 'not available'}{a.measurement.value_hectares != null ? ` (${a.measurement.value_hectares.toFixed(2)} ha)` : ''}</p>
      {a.layer_url && <button style={smallButton} onClick={() => void openAlertLayer(a)}>Show supporting change layer in Explorer</button>}
      {a.verification_status === 'pending' && <div style={actions}><button style={smallButton} onClick={() => void updateAlert(a.id, 'reviewed')}>Mark reviewed</button><button style={smallButton} onClick={() => void updateAlert(a.id, 'investigate')}>Investigate</button><button style={danger} onClick={() => void updateAlert(a.id, 'dismissed')}>Dismiss</button></div>}
    </article>)}</section>
    <p style={{ ...hint, marginTop: 20 }}>Alerts are potential changes supported by the selected satellite analysis. They do not confirm an environmental event or establish its cause. Scene cloud percentage does not describe AOI cloud cover; valid-pixel coverage is assessed during paired analysis. <Link to="/explorer" style={{ color: 'var(--color-primary)' }}>Open Earth Explorer</Link></p>
  </div>;
}

const card: React.CSSProperties = { padding: 16, borderRadius: 12, border: '1px solid var(--color-border-subtle)', background: 'var(--color-surface)' };
const h2: React.CSSProperties = { fontSize: 18, marginBottom: 10 };
const hint: React.CSSProperties = { color: 'var(--color-text-muted)', fontSize: 12, margin: '5px 0 10px' };
const label: React.CSSProperties = { display: 'grid', gap: 5, color: 'var(--color-text-muted)', fontSize: 12, margin: '10px 0' };
const input: React.CSSProperties = { width: '100%', color: 'var(--color-text)', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 6, padding: '8px 9px' };
const row: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 };
const actions: React.CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 };
const button: React.CSSProperties = { width: '100%', border: 0, borderRadius: 7, padding: 10, background: 'var(--color-primary-dim)', color: 'white', fontWeight: 700, cursor: 'pointer' };
const secondary: React.CSSProperties = { ...button, marginTop: 8, background: 'var(--color-surface-3)' };
const smallButton: React.CSSProperties = { border: '1px solid var(--color-border)', borderRadius: 6, padding: '6px 9px', background: 'var(--color-surface-2)', color: 'var(--color-text)', cursor: 'pointer', fontSize: 12 };
const danger: React.CSSProperties = { ...smallButton, color: 'var(--color-error)' };

