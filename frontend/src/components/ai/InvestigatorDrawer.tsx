"use client";

import { FormEvent, useState } from "react";
import { investigate } from "../../lib/api-client";
import type { InvestigationResponse } from "../../types/geospatial";

type Message = { role: "user" | "assistant"; text: string; result?: InvestigationResponse };
type Props = { analysisId?: string; locationName?: string; startDate?: string; endDate?: string };
const suggestions = ["How has vegetation changed in this region?", "Compare water coverage across two dates.", "Which areas show the greatest detected changes?", "What additional observations would help verify this result?", "Summarize this analysis."];
const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api";
const apiRoot = apiBase.replace(/\/api\/?$/, "");

export default function InvestigatorDrawer({ analysisId, locationName = "Selected region", startDate, endDate }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(question: string) {
    const clean = question.trim();
    if (!clean || busy) return;
    setMessages(current => [...current, { role: "user", text: clean }]);
    setText(""); setBusy(true); setError("");
    try {
      let response = await investigate(clean, analysisId);
      if (response.status === "analysis_started" || response.status === "accepted" || response.status === "running") {
        for (let attempt = 0; attempt < 40 && response.progress_url; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          const token = window.localStorage.getItem("terramind_access_token");
          const progress = await fetch(`${apiRoot}${response.progress_url}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
          const job = await progress.json();
          if (job.status === "completed") { response = await investigate(clean, response.analysis_id); break; }
          if (job.status === "failed") throw new Error(job.error?.detail ?? "The geospatial analysis failed.");
        }
      }
      setMessages(current => [...current, { role: "assistant", text: response.answer ?? response.message ?? response.interpretation ?? "No response was returned.", result: response }]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not reach the investigator service.");
    } finally { setBusy(false); }
  }

  function onSubmit(event: FormEvent) { event.preventDefault(); void submit(text); }

  return <aside aria-label="AI Earth Investigator" style={{ width: "min(430px, 100%)", height: "100%", minHeight: 560, display: "flex", flexDirection: "column", background: "#101b1b", color: "#e5efeb", borderLeft: "1px solid #29423c", fontFamily: "system-ui, sans-serif" }}>
    <header style={{ padding: 20, borderBottom: "1px solid #29423c" }}>
      <div style={{ color: "#9bd0a5", fontSize: 12, letterSpacing: 1.2, textTransform: "uppercase" }}>TerraMind AI</div>
      <h2 style={{ margin: "6px 0", fontSize: 21 }}>Earth Investigator</h2>
      <div style={{ color: "#aabbb5", fontSize: 13 }}>{locationName} · {startDate ?? "Earlier date"} → {endDate ?? "Later date"}</div>
      <div style={{ marginTop: 6, fontSize: 12, color: "#7f9990" }}>{analysisId ? `Evidence: ${analysisId}` : "Choose a completed analysis to investigate"}</div>
    </header>
    <section aria-live="polite" style={{ flex: 1, overflow: "auto", padding: 16 }}>
      {!messages.length && <><p style={{ color: "#b5c5bf", fontSize: 14 }}>Ask about measured changes. Findings come from completed geospatial analysis.</p><div style={{ display: "grid", gap: 8 }}>{suggestions.map(item => <button key={item} onClick={() => void submit(item)} style={suggestionStyle}>{item}</button>)}</div></>}
      {messages.map((message, i) => <article key={i} style={{ margin: "12px 0", padding: 13, background: message.role === "user" ? "#1a302b" : "#172422", borderRadius: 10 }}>
        <div style={{ fontSize: 11, color: "#9bd0a5", textTransform: "uppercase" }}>{message.role === "user" ? "Question" : "Investigation"}</div>
        <p style={{ margin: "6px 0 10px", lineHeight: 1.5 }}>{message.text}</p>
        {message.result?.finding && <><b>Finding</b><p style={paragraphStyle}>{message.result.finding}</p><b>Evidence</b><p style={paragraphStyle}>{message.result.evidence?.observation_dates?.earlier} → {message.result.evidence?.observation_dates?.later} · {message.result.evidence?.analysis_type} · {message.result.evidence?.valid_pixel_coverage_percent}% valid pixels</p><b>Interpretation</b><p style={paragraphStyle}>{message.result.interpretation}</p><b>Limitations</b><ul style={{ ...paragraphStyle, paddingLeft: 18 }}>{message.result.limitations?.map((warning, n) => <li key={n}>{warning}</li>)}</ul><b>Next step</b><p style={paragraphStyle}>{message.result.next_step}</p><a href={`${apiRoot}${message.result.evidence?.layers_url}`} target="_blank" rel="noreferrer" style={{ color: "#9bd0a5" }}>View supporting map layers</a>{message.result.evidence?.report_url && <> · <a href={message.result.evidence.report_url} style={{ color: "#9bd0a5" }}>Supporting report</a></>}</>}
      </article>)}
      {busy && <p role="status" style={{ color: "#9bd0a5", fontSize: 13 }}>Checking analysis progress and preparing an evidence-grounded answer…</p>}
      {error && <p role="alert" style={{ color: "#ffb4a9" }}>{error}</p>}
    </section>
    <form onSubmit={onSubmit} style={{ display: "flex", gap: 8, padding: 14, borderTop: "1px solid #29423c" }}><input aria-label="Ask about this region" value={text} onChange={event => setText(event.target.value)} placeholder="Ask about observed changes…" style={{ flex: 1, padding: 12, borderRadius: 8, border: "1px solid #34534a", background: "#0b1413", color: "white" }} /><button disabled={busy || !text.trim()} style={{ padding: "0 16px", border: 0, borderRadius: 8, background: "#9bd0a5", color: "#10201b", fontWeight: 700, cursor: "pointer" }}>Ask</button></form>
  </aside>;
}

const paragraphStyle = { margin: "5px 0 10px", fontSize: 13, lineHeight: 1.5, color: "#c3d1cc" } as const;
const suggestionStyle = { padding: "10px 12px", textAlign: "left" as const, color: "#d7e6df", background: "#152422", border: "1px solid #29423c", borderRadius: 8, cursor: "pointer" };
