"use client";

import { useState } from "react";
import InvestigatorDrawer from "../../components/ai/InvestigatorDrawer";

export default function ExplorerPage() {
  const [analysisId, setAnalysisId] = useState("");
  const [location, setLocation] = useState("Selected region");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  return <main style={{ minHeight: "100vh", background: "#0b1413", color: "#e5efeb", display: "flex", flexWrap: "wrap", justifyContent: "flex-end" }}>
    <div style={{ flex: "1 1 420px", minWidth: 0, padding: 32 }}><a href="/" style={{ color: "#9bd0a5" }}>TerraMind AI</a><h1>Earth observation explorer</h1><p style={{ color: "#aabbb5", maxWidth: 620, lineHeight: 1.6 }}>Investigate a completed Module 5 calculation. Measurements remain linked to its observation dates, region, and map layers.</p>
      <section style={{ display: "grid", gap: 12, maxWidth: 560, padding: 20, border: "1px solid #29423c", borderRadius: 12 }}><label>Analysis ID<input value={analysisId} onChange={e => setAnalysisId(e.target.value)} placeholder="Paste a completed analysis ID" style={fieldStyle} /></label><label>Region name<input value={location} onChange={e => setLocation(e.target.value)} style={fieldStyle} /></label><div style={{ display: "flex", gap: 12 }}><label>Start date<input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={fieldStyle} /></label><label>End date<input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={fieldStyle} /></label></div><small style={{ color: "#829890" }}>The analysis ID is the evidence source. Dates shown above are user context; the answer uses the dates recorded in the completed analysis.</small></section>
      <p style={{ color: "#829890", maxWidth: 560 }}>To run a new calculation, use the Module 5 vegetation, water, or urban endpoint, then paste its returned analysis ID here. This panel only explains actual completed measurements.</p>
    </div>
    <InvestigatorDrawer analysisId={analysisId || undefined} locationName={location || "Selected region"} startDate={startDate || undefined} endDate={endDate || undefined} />
  </main>;
}

const fieldStyle = { display: "block", boxSizing: "border-box" as const, width: "100%", marginTop: 5, padding: 10, borderRadius: 7, border: "1px solid #34534a", background: "#101b1b", color: "white" };
