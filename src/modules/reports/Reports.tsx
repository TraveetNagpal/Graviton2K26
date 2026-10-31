import { FormEvent, useCallback, useEffect, useState } from 'react';
import { authenticate, downloadReportFile, generateReport, getReport, listReports, saveDownload } from './api';
import type { ReportRecord } from './types';
import styles from './Reports.module.css';

const statusLabel = (status: string) => status.replace(/_/g, ' ');

export default function Reports() {
  const [reports, setReports] = useState<ReportRecord[]>([]);
  const [analysisId, setAnalysisId] = useState('');
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<ReportRecord | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [registering, setRegistering] = useState(false);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try { setReports(await listReports(signal)); setError(''); }
    catch (e) { if (!signal?.aborted) setError(e instanceof Error ? e.message : 'Could not load reports.'); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, []);

  useEffect(() => { const controller = new AbortController(); void refresh(controller.signal); return () => controller.abort(); }, [refresh]);

  async function onGenerate(event: FormEvent) {
    event.preventDefault();
    if (!analysisId.trim()) return;
    setSubmitting(true); setError(''); setNotice('');
    try {
      const result = await generateReport(analysisId, title || `Analysis report — ${analysisId}`);
      setNotice(result.report.status === 'completed' ? 'Report generated from the selected analysis.' : `Report ${statusLabel(result.report.status)}.`);
      setAnalysisId(''); setTitle('');
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Report generation failed. Check the analysis identifier and try again.'); }
    finally { setSubmitting(false); }
  }

  async function onAuthenticate(event: FormEvent) {
    event.preventDefault(); setError('');
    try { await authenticate(email, password, registering); setPassword(''); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Authentication failed.'); }
  }

  async function onDownload(report: ReportRecord, format: 'pdf' | 'csv' | 'geojson') {
    setError('');
    try { saveDownload(await downloadReportFile(report.id, format), `${report.id}.${format}`); }
    catch (e) { setError(e instanceof Error ? e.message : 'Download failed.'); }
  }

  async function onView(report: ReportRecord) {
    setError('');
    try { setSelected((await getReport(report.id)).report); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not open report details.'); }
  }

  return <section className={styles.page}>
    <div className={styles.topline}><div><p className={styles.eyebrow}>MODULE 9 · ANALYSIS OUTPUTS</p><h1>Reports</h1><p className={styles.subtitle}>Create traceable reports and export measurements from completed satellite analyses.</p></div><button className={styles.refresh} onClick={() => void refresh()} disabled={loading}>↻ Refresh</button></div>

    <form className={styles.create} onSubmit={onGenerate}>
      <div className={styles.formIntro}><span className={styles.icon}>↗</span><div><h2>Generate a report</h2><p>Reports use the selected analysis record as their source of truth.</p></div></div>
      <label>Analysis identifier<input required value={analysisId} onChange={e => setAnalysisId(e.target.value)} placeholder="Paste an analysis ID" /></label>
      <label>Report title <span className={styles.optional}>optional</span><input value={title} onChange={e => setTitle(e.target.value)} placeholder="Generated from analysis metadata" /></label>
      <button className={styles.generate} disabled={submitting || !analysisId.trim()}>{submitting ? 'Generating…' : 'Generate report'} <span>→</span></button>
    </form>

    {error && <div className={styles.alert} role="alert">{error}</div>}{notice && <div className={styles.notice} role="status">{notice}</div>}
    {(error.toLowerCase().includes('bearer token') || error.toLowerCase().includes('invalid or expired')) && <form className={styles.auth} onSubmit={onAuthenticate}><h2>Sign in to private reports</h2><p>Reports are private to your account.</p><input type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email address"/><input type="password" required minLength={12} autoComplete={registering ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="Password (12+ characters)"/><button className={styles.generate}>{registering ? 'Create account' : 'Sign in'}</button><button type="button" className={styles.authToggle} onClick={() => setRegistering(v => !v)}>{registering ? 'Already registered? Sign in' : 'New here? Create an account'}</button></form>}
    <div className={styles.listHeader}><div><h2>Report history</h2><p>Reports remain linked to their source analysis, observations, and method.</p></div><span className={styles.count}>{reports.length} reports</span></div>
    <div className={styles.tableWrap}><table><thead><tr><th>REPORT</th><th>REGION</th><th>ANALYSIS TYPE</th><th>CREATED</th><th>STATUS</th><th>DOWNLOADS</th></tr></thead><tbody>
      {loading ? <tr><td colSpan={6} className={styles.empty}>Loading report history…</td></tr> : reports.length === 0 ? <tr><td colSpan={6} className={styles.empty}>{error ? 'Report history is unavailable until the API connection is restored.' : 'No reports yet. Generate one from a completed analysis.'}</td></tr> : reports.map(report => <tr key={report.id}>
        <td><button className={styles.titleButton} onClick={() => void onView(report)}>{report.title}</button><small>ID · {report.id}</small></td><td>{report.region || '—'}</td><td>{report.analysisType || '—'}</td><td>{Number.isNaN(Date.parse(report.createdAt)) ? '—' : new Date(report.createdAt).toLocaleDateString()}</td><td><span className={`${styles.badge} ${styles[report.status] || ''}`}><i />{statusLabel(report.status)}</span></td>
        <td><div className={styles.actions}>{report.status === 'completed' && <><button onClick={() => void onDownload(report, 'pdf')}>PDF</button><button onClick={() => void onDownload(report, 'csv')}>CSV</button>{report.geojsonAvailable && <button onClick={() => void onDownload(report, 'geojson')}>GeoJSON</button>}</>}{report.status === 'failed' && <span className={styles.failure} title={report.error}>Failed</span>}</div></td>
      </tr>)}
    </tbody></table></div>
    {selected && <section className={styles.detail} aria-label="Report details"><div className={styles.detailHeader}><div><p className={styles.eyebrow}>REPORT DETAILS · {selected.id}</p><h2>{selected.title}</h2></div><button onClick={() => setSelected(null)} aria-label="Close report details">×</button></div><dl><dt>Region</dt><dd>{selected.region || '—'}</dd><dt>Dataset</dt><dd>{selected.dataset || '—'}</dd><dt>Analysis method</dt><dd>{selected.analysisMethod || '—'}</dd><dt>Observation dates</dt><dd>{selected.observationDates?.join(' → ') || '—'}</dd></dl>{selected.measurements?.length ? <div className={styles.measurements}><h3>Measurements</h3>{selected.measurements.map((m, i) => <div key={`${m.name}-${i}`}><span>{m.name}</span><strong>{m.value ?? '—'}{m.unit ? ` ${m.unit}` : ''}</strong></div>)}</div> : <p className={styles.detailNote}>No tabular measurements were returned for this report.</p>}</section>}
    <p className={styles.footnote}>Exports are available only when returned by the analysis service. Raster layers are delivered in the PDF and are never labeled as GeoJSON.</p>
  </section>;
}
