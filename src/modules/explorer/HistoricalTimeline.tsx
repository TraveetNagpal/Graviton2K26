import React, { useMemo, useState } from 'react';
import { useExplorerStore } from '@/store';
import styles from './HistoricalTimeline.module.css';

type Frequency = 'daily' | 'weekly' | 'monthly' | 'quarterly';
type Observation = { date: string; dataset: string; image_id: string; cloud_cover?: number | null };
type Point = { date: string; image_id: string; dataset: string; status: string; value?: { value: number | null; unit: string }; valid_pixel_coverage_percent?: number; layer_url?: string; layer_name?: string; warning?: string };
type Trend = { analysis_id: string; status: string; baseline: { date: string }; points: Point[]; quality_warnings: string[]; measurement_definition: string; missing_observation_count: number };
const API_BASE = String((import.meta as any).env?.VITE_API_BASE_URL || '/api').replace(/\/v1\/?$/, '');

function bucket(date: string, frequency: Frequency) {
  if (frequency === 'daily') return date;
  if (frequency === 'monthly') return date.slice(0, 7);
  const value = new Date(`${date}T00:00:00Z`);
  if (frequency === 'quarterly') return `${date.slice(0, 4)} Q${Math.floor(value.getUTCMonth() / 3) + 1}`;
  value.setUTCDate(value.getUTCDate() - ((value.getUTCDay() + 6) % 7));
  return `week of ${value.toISOString().slice(0, 10)}`;
}

function periods(start: string, end: string, frequency: Frequency) {
  const output: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`), finish = new Date(`${end}T00:00:00Z`);
  if (frequency === 'weekly') cursor.setUTCDate(cursor.getUTCDate() - ((cursor.getUTCDay() + 6) % 7));
  if (frequency === 'monthly') cursor.setUTCDate(1);
  if (frequency === 'quarterly') { cursor.setUTCDate(1); cursor.setUTCMonth(Math.floor(cursor.getUTCMonth() / 3) * 3); }
  while (cursor < finish && output.length < 4000) {
    output.push(bucket(cursor.toISOString().slice(0, 10), frequency));
    if (frequency === 'daily') cursor.setUTCDate(cursor.getUTCDate() + 1);
    else if (frequency === 'weekly') cursor.setUTCDate(cursor.getUTCDate() + 7);
    else cursor.setUTCMonth(cursor.getUTCMonth() + (frequency === 'monthly' ? 1 : 3));
  }
  return output;
}

function midpoint(period: string, frequency: Frequency) {
  if (frequency === 'daily') return period;
  if (frequency === 'weekly') return period.slice(8);
  if (frequency === 'monthly') return `${period}-15`;
  const [, quarter] = period.split(' Q');
  return `${period.slice(0, 4)}-${String(Number(quarter) * 3 - 1).padStart(2, '0')}-15`;
}

function representative(images: Observation[], frequency: Frequency) {
  const groups = new Map<string, Observation[]>();
  images.forEach(image => { const key = bucket(image.date, frequency); groups.set(key, [...(groups.get(key) ?? []), image]); });
  return [...groups.values()].map(group => group.sort((a, b) => (a.cloud_cover ?? 101) - (b.cloud_cover ?? 101))[0]).sort((a, b) => a.date.localeCompare(b.date));
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.detail?.detail ?? data.detail ?? data.error ?? `Request failed (${response.status})`);
  return data as T;
}

export default function HistoricalTimeline() {
  const selection = useExplorerStore(s => s.activeSelection);
  const showAnalysisLayer = useExplorerStore(s => s.showAnalysisLayer);
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(''); const [end, setEnd] = useState('');
  const [dataset, setDataset] = useState('sentinel-2'); const [kind, setKind] = useState('vegetation');
  const [frequency, setFrequency] = useState<Frequency>('monthly'); const [cloud, setCloud] = useState(40);
  const [images, setImages] = useState<Observation[]>([]); const [selected, setSelected] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  const [baseline, setBaseline] = useState(''); const [trend, setTrend] = useState<Trend | null>(null);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [error, setError] = useState('');
  const sampled = useMemo(() => representative(images, frequency), [images, frequency]);
  const availableBuckets = new Set(sampled.map(image => bucket(image.date, frequency)));
  const missingPeriods = start && end ? periods(start, end, frequency).filter(period => !availableBuckets.has(period)) : [];
  const geometry = selection?.geometry;
  const pointById = new Map<string, Point>((trend?.points ?? []).map(point => [point.image_id, point] as const));

  async function search(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setTrend(null); setImages([]); setHasSearched(false);
    try {
      if (geometry?.type !== 'Polygon') throw new Error('Select a polygonal region on the map first.');
      if (!start || !end || end <= start) throw new Error('Choose a start date and a later exclusive end date.');
      const result = await post<{ observations: Observation[] }>('/satellite/search', { area_of_interest: geometry, start_date: start, end_date: end, dataset, max_cloud_cover: cloud });
      setImages(result.observations); setBaseline(''); setHasSearched(true); setMessage(`${result.observations.length} real catalog observations found.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Satellite search failed.'); }
    finally { setBusy(false); }
  }

  async function selectDate(image: Observation) {
    setBusy(true); setSelected(image.image_id); setError('');
    try {
      const point = pointById.get(image.image_id);
      if (point?.layer_url) {
        const root = API_BASE.replace(/\/api\/?$/, '');
        const response = await fetch(`${root}${point.layer_url}`); const data = await response.json();
        const layer = data.layers?.find((entry: { name: string }) => entry.name === point.layer_name) ?? data.layers?.[0];
        if (layer?.tile_url_template) { showAnalysisLayer(layerId(kind), layer.tile_url_template); return; }
      }
      const preview = await post<{ layer: { tile_url_template: string } }>('/satellite/preview', { image_id: image.image_id, dataset: image.dataset, area_of_interest: geometry });
      showAnalysisLayer(layerId(kind), preview.layer.tile_url_template);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load selected observation.'); }
    finally { setBusy(false); }
  }

  async function measureTrend() {
    setBusy(true); setError(''); setMessage(''); setTrend(null);
    try {
      if (sampled.length < 2 || sampled.length > 30) throw new Error('Choose 2–30 actual observations. Use a coarser frequency or shorter date range when needed.');
      if (!baseline) throw new Error('Choose a baseline date.');
      const accepted = await post<{ analysis_id: string }>('/analysis/trend', { analysis_type: kind, observations: sampled.map(image => ({ date: image.date, image_id: image.image_id, dataset: image.dataset })), baseline_image_id: baseline, area_of_interest: geometry });
      let result: Trend | null = null;
      for (let i = 0; i < 150; i++) {
        await new Promise(resolve => setTimeout(resolve, 1500));
        const response = await fetch(`${API_BASE}/analysis/${accepted.analysis_id}`); result = await response.json();
        setMessage(`Measuring actual observations against the selected baseline (${i + 1}/150)…`);
        if (result?.status === 'completed' || result?.status === 'failed') break;
      }
      if (!result || result.status !== 'completed') throw new Error('Historical analysis did not complete. Check backend status and try again.');
      setTrend(result); setMessage(`${result.points.filter(point => point.status === 'completed').length} measurements available; ${result.missing_observation_count} unavailable.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Trend measurement failed.'); }
    finally { setBusy(false); }
  }

  const chart = trend?.points.filter(point => point.status === 'completed' && typeof point.value?.value === 'number') ?? [];
  const values = chart.map(point => point.value!.value as number);
  const low = values.length ? Math.min(...values) : 0, high = values.length ? Math.max(...values) : 1, span = high - low || 0.01;
  const firstDate = trend?.points[0]?.date, lastDate = trend?.points[trend.points.length - 1]?.date;
  const timeStart = firstDate ? new Date(firstDate).getTime() : 0;
  const timeSpan = firstDate && lastDate ? Math.max(1, new Date(lastDate).getTime() - timeStart) : 1;
  const chartX = (point: Point) => 12 + (new Date(point.date).getTime() - timeStart) / timeSpan * 276;
  const chartY = (point: Point) => 82 - ((point.value!.value as number) - low) / span * 64;
  const gaps = missingPeriods.map(period => midpoint(period, frequency));
  const segments: Point[][] = []; let segment: Point[] = [], previous: Point | undefined;
  for (const point of trend?.points ?? []) {
    if (point.status !== 'completed' || typeof point.value?.value !== 'number') { if (segment.length) segments.push(segment); segment = []; previous = undefined; continue; }
    if (previous && gaps.some(gap => gap > previous!.date && gap < point.date)) { if (segment.length) segments.push(segment); segment = []; }
    segment.push(point); previous = point;
  }
  if (segment.length) segments.push(segment);

  return <>
    <button className={styles.toggle} onClick={() => setOpen(!open)}>Historical timeline</button>
    {open && <aside className={styles.panel} aria-label="Historical satellite timeline">
      <h2>Historical analysis</h2><p className={styles.hint}>{selection ? 'Selected map region · real catalog observations only' : 'Draw a polygon on the map to select a region.'}</p>
      <form onSubmit={search}>
        <div className={styles.row}><label className={styles.field}>Start date<input className={styles.input} type="date" value={start} onChange={e => setStart(e.target.value)} /></label><label className={styles.field}>End date (exclusive)<input className={styles.input} type="date" value={end} onChange={e => setEnd(e.target.value)} /></label></div>
        <div className={styles.row}><label className={styles.field}>Dataset<select className={styles.select} value={dataset} onChange={e => setDataset(e.target.value)}><option value="sentinel-2">Sentinel-2</option><option value="landsat">Landsat 8 + 9</option><option value="landsat-8">Landsat 8</option><option value="landsat-9">Landsat 9</option></select></label><label className={styles.field}>Frequency<select className={styles.select} value={frequency} onChange={e => { setFrequency(e.target.value as Frequency); setTrend(null); }}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option></select></label></div>
        <div className={styles.row}><label className={styles.field}>Analysis<select className={styles.select} value={kind} onChange={e => { setKind(e.target.value); setTrend(null); }}><option value="vegetation">NDVI vegetation</option><option value="water">Mapped water coverage</option><option value="urban">Built-up proxy</option></select></label><label className={styles.field}>Max scene cloud %<input className={styles.input} type="number" min="0" max="100" value={cloud} onChange={e => setCloud(Number(e.target.value))} /></label></div>
        <button className={styles.button} disabled={busy}>Search available observations</button>
      </form>
      {message && <p className={styles.message} role="status">{message}</p>}{error && <p className={styles.error} role="alert">{error}</p>}
      {hasSearched && <><h3>Observation dates</h3>{missingPeriods.length > 0 && <p className={styles.warning}>No catalog observation in: {missingPeriods.slice(0, 12).join(', ')}{missingPeriods.length > 12 ? ` … +${missingPeriods.length - 12} more` : ''}</p>}{images.length === 0 && <p className={styles.hint}>No matching observation was available in the selected range.</p>}<div className={styles.timeline}>{sampled.map(image => <button key={image.image_id} className={`${styles.observation} ${selected === image.image_id ? styles.selected : ''}`} onClick={() => void selectDate(image)}><b>{image.date}</b><span>{image.cloud_cover == null ? 'Cloud: n/a' : `Scene cloud: ${image.cloud_cover}%`}</span><span>{pointById.get(image.image_id)?.status === 'completed' ? `${pointById.get(image.image_id)?.valid_pixel_coverage_percent?.toFixed(1)}% valid` : pointById.get(image.image_id)?.status === 'unavailable' ? 'No valid measurement' : image.dataset}</span></button>)}</div>
        <label className={styles.field}>Baseline<select className={styles.select} value={baseline} onChange={e => setBaseline(e.target.value)}><option value="">Select an observation</option>{sampled.map(image => <option key={image.image_id} value={image.image_id}>{image.date}</option>)}</select></label>
        <button className={styles.button} disabled={busy || sampled.length < 2} onClick={() => void measureTrend()}>Measure periods against baseline</button>
      </>}
      {trend?.status === 'completed' && <><h3>{kind === 'vegetation' ? 'NDVI trend' : kind === 'water' ? 'Mapped water estimate' : 'Built-up proxy estimate'}</h3><p className={styles.hint}>Baseline {trend.baseline.date}. Values shown only for completed observations.</p>{values.length > 0 ? <svg className={styles.chart} viewBox="0 0 300 100" role="img" aria-label="Historical measurement trend"><line x1="10" y1="84" x2="290" y2="84" stroke="#496058" />{segments.map((items, index) => <polyline key={index} fill="none" stroke="#9bd0a5" strokeWidth="2" points={items.map(point => `${chartX(point)},${chartY(point)}`).join(' ')} />)}{chart.map(point => <circle key={point.image_id} cx={chartX(point)} cy={chartY(point)} r="3" fill="#9bd0a5"><title>{point.date}: {point.value?.value}</title></circle>)}</svg> : <p className={styles.hint}>No completed data points to chart.</p>}{trend.quality_warnings.map(warning => <p className={styles.warning} key={warning}>⚠ {warning}</p>)}{trend.points.map(point => <button key={point.image_id} className={styles.point} onClick={() => { const image = images.find(item => item.image_id === point.image_id); if (image) void selectDate(image); }}><span>{point.date} · {point.status === 'completed' ? `${point.value?.value} ${point.value?.unit}` : 'missing / unavailable'}</span><span>{point.valid_pixel_coverage_percent?.toFixed(1) ?? '—'}%</span></button>)}</>}
      <p className={styles.hint}>Scene cloud percentage does not describe the selected area. Pairwise QA-valid pixel coverage can vary. Missing periods and invalid measurements are never treated as zero.</p>
    </aside>}
  </>;
}

function layerId(kind: string) { return kind === 'vegetation' ? 'vegetation-ndvi' : kind === 'water' ? 'water-analysis' : 'urban-change'; }
