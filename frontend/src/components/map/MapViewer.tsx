"use client";

import type { JSX } from "react";

type Props = { tileUrl?: string; region?: Record<string, unknown>; title?: string };

function centerOf(geojson?: Record<string, unknown>): [number, number] {
  try {
    const geometry = (geojson?.geometry ?? geojson) as { coordinates?: unknown; type?: string };
    const flat: number[][] = [];
    const walk = (value: unknown) => { if (Array.isArray(value) && typeof value[0] === "number" && typeof value[1] === "number") flat.push(value as number[]); else if (Array.isArray(value)) value.forEach(walk); };
    walk(geometry?.coordinates);
    if (flat.length) return [(Math.min(...flat.map(p => p[0])) + Math.max(...flat.map(p => p[0]))) / 2, (Math.min(...flat.map(p => p[1])) + Math.max(...flat.map(p => p[1]))) / 2];
  } catch { /* fall through to a neutral center */ }
  return [0, 0];
}

export default function MapViewer({ tileUrl, region, title = "Selected observation map layer" }: Props) {
  if (!tileUrl) return <div style={{ height: 250, display: "grid", placeItems: "center", border: "1px solid #29423c", borderRadius: 10, color: "#829890", background: "#101b1b" }}>Select an observation to load its map preview.</div>;
  const [longitude, latitude] = centerOf(region);
  const zoom = 9, count = 2 ** zoom;
  const centerX = Math.floor((longitude + 180) / 360 * count);
  const latRad = Math.max(-85.0511, Math.min(85.0511, latitude)) * Math.PI / 180;
  const centerY = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * count);
  const tiles: JSX.Element[] = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    tiles.push(<img key={`${dx}:${dy}`} alt="" src={tileUrl.replace("{z}", String(zoom)).replace("{x}", String(centerX + dx)).replace("{y}", String(centerY + dy))} width={256} height={256} style={{ display: "block" }} />);
  }
  return <div><div style={{ color: "#aabbb5", fontSize: 13, marginBottom: 6 }}>{title}</div><div role="img" aria-label={title} style={{ width: "100%", maxWidth: 512, height: 320, overflow: "hidden", border: "1px solid #34534a", borderRadius: 10, background: "#16221f" }}><div style={{ width: 768, height: 768, display: "grid", gridTemplateColumns: "repeat(3, 256px)", transform: "translate(-128px, -224px)" }}>{tiles}</div></div></div>;
}
