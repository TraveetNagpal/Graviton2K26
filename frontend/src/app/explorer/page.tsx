"use client";

import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import InvestigatorDrawer from "../../components/ai/InvestigatorDrawer";
import TimelineChart, { TrendPoint } from "../../components/analysis/TimelineChart";
import MapViewer from "../../components/map/MapViewer";
import { getAnalysisLayers, getHistoricalTrend, previewSatellite, searchSatellite, startHistoricalTrend } from "../../lib/api-client";
import type { HistoricalPoint, HistoricalTrend, SatelliteObservation } from "../../types/geospatial";

type Frequency = "daily" | "weekly" | "monthly" | "quarterly";
const defaultAoi = "";

function bucket(dateValue: string, frequency: Frequency) {
  const date = new Date(`${dateValue}T00:00:00Z`);
  if (frequency === "daily") return dateValue;
  if (frequency === "monthly") return dateValue.slice(0, 7);
  if (frequency === "quarterly") return `${dateValue.slice(0, 4)} Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return `week of ${date.toISOString().slice(0, 10)}`;
}

function periods(start: string, end: string, frequency: Frequency) {
  const output: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`), exclusiveEnd = new Date(`${end}T00:00:00Z`);
  if (frequency === "weekly") cursor.setUTCDate(cursor.getUTCDate() - ((cursor.getUTCDay() + 6) % 7));
  if (frequency === "monthly") cursor.setUTCDate(1);
  if (frequency === "quarterly") { cursor.setUTCDate(1); cursor.setUTCMonth(Math.floor(cursor.getUTCMonth() / 3) * 3); }
  while (cursor < exclusiveEnd && output.length < 4000) {
    const iso = cursor.toISOString().slice(0, 10);
    output.push(bucket(iso, frequency));
    if (frequency === "daily") cursor.setUTCDate(cursor.getUTCDate() + 1);
    else if (frequency === "weekly") cursor.setUTCDate(cursor.getUTCDate() + 7);
    else cursor.setUTCMonth(cursor.getUTCMonth() + (frequency === "monthly" ? 1 : 3));
  }
  return output;
}

function sampleFrequency(observations: SatelliteObservation[], frequency: Frequency) {
  const groups = new Map<string, SatelliteObservation[]>();
  observations.forEach(item => { const key = bucket(item.date, frequency); groups.set(key, [...(groups.get(key) ?? []), item]); });
  return [...groups.values()].map(group => group.sort((a, b) => (a.cloud_cover ?? 101) - (b.cloud_cover ?? 101))[0]).sort((a, b) => a.date.localeCompare(b.date));
}

function gapDate(period: string, frequency: Frequency) {
  if (frequency === "daily") return period;
  if (frequency === "weekly") return period.replace("week of ", "");
  if (frequency === "monthly") return `${period}-15`;
  const [, quarter] = period.split(" Q");
  return `${period.slice(0, 4)}-${String(Number(quarter) * 3 - 1).padStart(2, "0")}-15`;
}

export default function ExplorerPage() {
  const [regionName, setRegionName] = useState("Selected region");
  const [aoiText, setAoiText] = useState(defaultAoi);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [dataset, setDataset] = useState("sentinel-2");
  const [analysisType, setAnalysisType] = useState("vegetation");
  const [frequency, setFrequency] = useState<Frequency>("monthly");
  const [maxCloud, setMaxCloud] = useState(40);
  const [observations, setObservations] = useState<SatelliteObservation[]>([]);
  const [selected, setSelected] = useState<SatelliteObservation | null>(null);
  const [baselineId, setBaselineId] = useState("");
  const [trend, setTrend] = useState<HistoricalTrend | null>(null);
  const [tileUrl, setTileUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  function invalidateSearch() { setObservations([]); setSelected(null); setBaselineId(""); setTrend(null); setTileUrl(""); }
  const selectedPeriods = useMemo(() => sampleFrequency(observations, frequency), [observations, frequency]);
  const actualBuckets = new Set(selectedPeriods.map(item => bucket(item.date, frequency)));
  const missingPeriods = startDate && endDate ? periods(startDate, endDate, frequency).filter(key => !actualBuckets.has(key)) : [];
  const region = useMemo(() => { try { return aoiText ? JSON.parse(aoiText) : undefined; } catch { return undefined; } }, [aoiText]);

  async function search(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setMessage(""); setTrend(null); setTileUrl(""); setSelected(null);
    try {
      if (!region || !startDate || !endDate) throw new Error("Enter a valid GeoJSON polygon and an inclusive start / exclusive end date.");
      const result = await searchSatellite({ area_of_interest: region, start_date: startDate, end_date: endDate, dataset, max_cloud_cover: maxCloud });
      setObservations(result.observations); setBaselineId("");
      setMessage(`${result.observations.length} real catalog observations returned. Scene cloud is catalog metadata; it does not describe cloudiness within the selected area.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Satellite search failed."); }
    finally { setBusy(false); }
  }

  async function selectObservation(observation: SatelliteObservation) {
    setSelected(observation); setBusy(true); setError("");
    try {
      const point = trend?.points.find(item => item.image_id === observation.image_id && item.status === "completed");
      if (point?.layer_url) {
        const layers = await getAnalysisLayers(point.layer_url);
        const desired = point.layer_name ?? (observation.image_id === trend?.baseline.image_id ? "earlier_index" : analysisType === "water" ? "water_extent_later" : analysisType === "urban" ? "built_up_proxy_later" : "later_index");
        const layer = layers.find(item => item.name === desired) ?? layers[0];
        if (layer) { setTileUrl(layer.tile_url_template); setBusy(false); return; }
      }
      const preview = await previewSatellite({ image_id: observation.image_id, dataset: observation.dataset, area_of_interest: region });
      setTileUrl(preview.layer.tile_url_template);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load this observation layer."); setTileUrl(""); }
    finally { setBusy(false); }
  }

  async function buildTrend() {
    setBusy(true); setError(""); setMessage(""); setTrend(null);
    try {
      if (selectedPeriods.length < 2) throw new Error("At least two actual observations are required for a trend.");
      if (selectedPeriods.length > 30) throw new Error("This frequency yields more than 30 observations. Choose a coarser frequency or a shorter date range.");
      if (!baselineId) throw new Error("Select a baseline observation.");
      const response = await startHistoricalTrend({ analysis_type: analysisType, observations: selectedPeriods.map(item => ({ date: item.date, image_id: item.image_id, dataset: item.dataset })), baseline_image_id: baselineId, area_of_interest: region });
      let latest = await getHistoricalTrend(response.analysis_id);
      for (let attempt = 0; latest.status !== "completed" && latest.status !== "failed" && attempt < 150; attempt++) {
        setMessage(`Measuring observations against ${selectedPeriods.find(item => item.image_id === baselineId)?.date ?? "baseline"} (${attempt + 1}/150)…`);
        await new Promise(resolve => setTimeout(resolve, 1500));
        latest = await getHistoricalTrend(response.analysis_id);
      }
      if (latest.status !== "completed") throw new Error("Trend is still processing or failed. Check its analysis status and try again.");
      setTrend(latest); setMessage(`${latest.points.filter(point => point.status === "completed").length} dated measurements completed. ${latest.missing_observation_count} selected observations are unavailable, not zero.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Historical trend failed."); }
    finally { setBusy(false); }
  }

  const pointById = new Map<string, HistoricalPoint>((trend?.points ?? []).map(point => [point.image_id, point] as const));
  const chartPoints: TrendPoint[] = trend?.points ?? [];
  const chartGaps = missingPeriods.map(period => gapDate(period, frequency));
  const analysisId = selected ? pointById.get(selected.image_id)?.analysis_id : undefined;

  return <main style={{ minHeight: "100vh", background: "#0b1413", color: "#e5efeb", display: "flex", justifyContent: "flex-end" }}>
    <div style={{ flex: 1, minWidth: 0, padding: 28, overflowY: "auto" }}>
      <a href="/" style={{ color: "#9bd0a5" }}>TerraMind AI</a><h1>Historical satellite explorer</h1>
      <p style={muted}>Search real Earth Engine observations, select a date as the map layer, and measure multiple dates against a baseline.</p>
      <form onSubmit={search} style={panel}>
        <label>Region name<input value={regionName} onChange={event => { invalidateSearch(); setRegionName(event.target.value); }} style={field} /></label>
        <label>Region GeoJSON<textarea value={aoiText} onChange={event => { invalidateSearch(); setAoiText(event.target.value); }} placeholder="Paste a WGS84 Polygon or MultiPolygon" rows={4} style={field} /></label>
        <div style={row}><label>Start date<input type="date" required value={startDate} onChange={event => { invalidateSearch(); setStartDate(event.target.value); }} style={field} /></label><label>End date (exclusive)<input type="date" required value={endDate} onChange={event => { invalidateSearch(); setEndDate(event.target.value); }} style={field} /></label></div>
        <div style={row}><label>Dataset<select value={dataset} onChange={event => { invalidateSearch(); setDataset(event.target.value); }} style={field}><option value="sentinel-2">Sentinel-2 Surface Reflectance</option><option value="landsat">Landsat Collection 2 Level 2</option><option value="landsat-8">Landsat 8 Collection 2</option><option value="landsat-9">Landsat 9 Collection 2</option></select></label><label>Frequency<select value={frequency} onChange={event => { invalidateSearch(); setFrequency(event.target.value as Frequency); }} style={field}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option></select></label><label>Analysis<select value={analysisType} onChange={event => { invalidateSearch(); setAnalysisType(event.target.value); }} style={field}><option value="vegetation">NDVI vegetation</option><option value="water">NDWI mapped water</option><option value="urban">NDBI built-up proxy</option></select></label><label>Max scene cloud %<input type="number" min={0} max={100} value={maxCloud} onChange={event => { invalidateSearch(); setMaxCloud(Number(event.target.value)); }} style={field} /></label></div>
        <button disabled={busy} style={primary}>{busy ? "Working…" : "Search available observations"}</button>
      </form>
      {message && <p role="status" style={{ color: "#9bd0a5" }}>{message}</p>}{error && <p role="alert" style={{ color: "#ffb4a9" }}>{error}</p>}
      {!!observations.length && <section style={panel}>
        <h2>Observation timeline</h2><p style={muted}>Showing one real catalog observation with the lowest reported scene cloud in each {frequency} period. Blank periods contain no matching observation.</p>
        {missingPeriods.length > 0 && <div style={{ color: "#ffd580", marginBottom: 12 }}>Missing observation periods: {missingPeriods.slice(0, 18).join(", ")}{missingPeriods.length > 18 ? ` … +${missingPeriods.length - 18} more` : ""}</div>}
        <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: "8px 0" }}>{selectedPeriods.map(observation => <button key={observation.image_id} onClick={() => void selectObservation(observation)} style={{ ...obsCard, outline: selected?.image_id === observation.image_id ? "2px solid #9bd0a5" : "none" }}><b>{observation.date}</b><span>{observation.dataset}</span><span>Scene cloud: {observation.cloud_cover == null ? "not reported" : `${observation.cloud_cover}%`}</span><span>{pointById.get(observation.image_id)?.status === "completed" ? "Measurement available" : pointById.has(observation.image_id) ? "Measurement unavailable" : "Not yet measured"}</span></button>)}</div>
        <div style={row}><label>Baseline<select value={baselineId} onChange={event => setBaselineId(event.target.value)} style={field}><option value="">Choose observation</option>{selectedPeriods.map(item => <option key={item.image_id} value={item.image_id}>{item.date} · {item.dataset}</option>)}</select></label><button onClick={() => void buildTrend()} disabled={busy || selectedPeriods.length < 2} style={primary}>Measure trend against baseline</button></div>
      </section>}
      {selected && <section style={panel}><h2>{selected.date} · {regionName}</h2><p style={muted}>Scene cloud cover: {selected.cloud_cover == null ? "not reported" : `${selected.cloud_cover}%`}. Select another date to update this map.</p><MapViewer tileUrl={tileUrl} region={region} title={pointById.get(selected.image_id)?.status === "completed" ? "Processed analysis layer for selected observation" : "True-colour preview of selected observation"} />{busy && <small style={muted}>Loading the selected Earth Engine layer…</small>}</section>}
      {trend?.status === "completed" && <section style={panel}><h2>{analysisType === "vegetation" ? "NDVI trend" : analysisType === "water" ? "Mapped water coverage trend" : "Mapped built-up proxy trend"}</h2><p style={muted}>Baseline: {trend.baseline.date}. {trend.measurement_definition}</p><TimelineChart points={chartPoints} gaps={chartGaps} label={analysisType === "vegetation" ? "Mean NDVI" : analysisType === "water" ? "Mapped water area" : "Mapped built-up proxy area"} />{trend.quality_warnings.map((warning, i) => <p key={i} style={{ color: "#ffd580" }}>⚠ {warning}</p>)}<div style={{ display: "grid", gap: 6, marginTop: 14 }}>{trend.points.map(point => <button key={point.image_id} onClick={() => { const observation = observations.find(item => item.image_id === point.image_id); if (observation) void selectObservation(observation); }} style={pointRow}><span>{point.date}</span><span>{point.status === "completed" ? `${point.value?.value ?? "missing"} ${point.value?.unit}` : "No valid measurement"}</span><span>{point.valid_pixel_coverage_percent == null ? "" : `${point.valid_pixel_coverage_percent.toFixed(1)}% valid`}</span>{point.warning && <small style={{ color: "#ffd580" }}>{point.warning}</small>}</button>)}</div></section>}
      <p style={muted}>Trend inputs are actual Earth Engine catalog images. Date buckets without observations remain gaps; cloud masking or insufficient shared valid pixels can also make an observation unavailable. Cross-sensor and seasonal comparisons are flagged.</p>
    </div>
    <InvestigatorDrawer analysisId={analysisId} locationName={regionName} startDate={startDate || undefined} endDate={endDate || undefined} />
  </main>;
}

const muted = { color: "#aabbb5", maxWidth: 900, lineHeight: 1.5 } as const;
const panel = { display: "grid", gap: 12, margin: "18px 0", padding: 18, border: "1px solid #29423c", borderRadius: 12, background: "#101b1b" } as const;
const field = { display: "block", boxSizing: "border-box", width: "100%", marginTop: 5, padding: 10, borderRadius: 7, border: "1px solid #34534a", background: "#0b1413", color: "white" } as const;
const row = { display: "flex", flexWrap: "wrap", alignItems: "end", gap: 12 } as const;
const primary = { alignSelf: "end", padding: "11px 16px", border: 0, borderRadius: 8, background: "#9bd0a5", color: "#10201b", fontWeight: 700, cursor: "pointer" } as const;
const obsCard = { minWidth: 150, display: "grid", gap: 6, padding: 12, textAlign: "left", color: "#d7e6df", background: "#152422", border: "1px solid #29423c", borderRadius: 9, cursor: "pointer" } as const;
const pointRow = { display: "flex", flexWrap: "wrap", gap: 18, padding: 10, textAlign: "left", color: "#d7e6df", background: "#152422", border: "1px solid #29423c", borderRadius: 7, cursor: "pointer" } as const;
