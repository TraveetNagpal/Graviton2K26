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
