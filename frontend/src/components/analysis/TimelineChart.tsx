"use client";

export type TrendPoint = { date: string; status: string; value?: { value: number | null; unit: string; metric: string } | null };

export default function TimelineChart({ points, label, gaps = [] }: { points: TrendPoint[]; label: string; gaps?: string[] }) {
  const usable = points.filter(point => point.status === "completed" && typeof point.value?.value === "number");
  if (!usable.length) return <div role="status" style={{ color: "#9aaca4", padding: 20 }}>No completed measurements are available for this chart. Missing observations are not plotted as zero.</div>;
  const width = 700, height = 220, left = 48, right = 16, top = 18, bottom = 38;
  const values = usable.map(point => point.value!.value as number);
  const min = Math.min(...values), max = Math.max(...values), span = max - min || Math.max(Math.abs(max) * 0.1, 0.01);
  const x = (date: string) => left + (new Date(date).getTime() - new Date(points[0].date).getTime()) / Math.max(1, new Date(points[points.length - 1].date).getTime() - new Date(points[0].date).getTime()) * (width - left - right);
  const y = (value: number) => top + (max + span * 0.08 - value) / (span * 1.16) * (height - top - bottom);
  const segments: string[] = []; let active = "", previousDate: string | undefined;
  points.forEach(point => {
    if (point.status !== "completed" || typeof point.value?.value !== "number") { if (active) segments.push(active); active = ""; previousDate = undefined; return; }
    if (previousDate && gaps.some(gap => gap > previousDate! && gap < point.date)) { if (active) segments.push(active); active = ""; }
    active += `${active ? " L" : "M"}${x(point.date).toFixed(1)},${y(point.value.value).toFixed(1)}`;
    previousDate = point.date;
  });
  if (active) segments.push(active);
  const unit = usable[0].value!.unit;
  return <div style={{ overflowX: "auto" }}><div style={{ color: "#aabbb5", fontSize: 13, margin: "6px 0" }}>{label} · {unit} · points represent completed observations only</div><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label} over actual observation dates`} style={{ width: "100%", minWidth: 420, maxHeight: 240 }}>
    <line x1={left} x2={width - right} y1={height - bottom} y2={height - bottom} stroke="#496058" />
    <line x1={left} x2={left} y1={top} y2={height - bottom} stroke="#496058" />
    {segments.map((path, index) => <path key={index} d={path} fill="none" stroke="#9bd0a5" strokeWidth="2.5" />)}
    {usable.map(point => <g key={point.date}><circle cx={x(point.date)} cy={y(point.value!.value as number)} r="4" fill="#9bd0a5"><title>{point.date}: {point.value!.value}</title></circle><text x={x(point.date)} y={height - 13} fill="#9aaca4" fontSize="10" textAnchor="middle">{point.date}</text></g>)}
    <text x={5} y={top + 8} fill="#9aaca4" fontSize="10">{max.toPrecision(3)}</text><text x={5} y={height - bottom} fill="#9aaca4" fontSize="10">{min.toPrecision(3)}</text>
  </svg></div>;
}
