import Link from "next/link";

const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api";
const docsUrl = `${apiBase.replace(/\/api\/?$/, "")}/docs`;

const cards = [
  {
    title: "Change analysis",
    body: "Measure NDVI, NDWI, and NDBI differences between two Earth Engine observations with explicit QA masks and valid-pixel coverage.",
  },
  {
    title: "Earth Investigator",
    body: "Ask questions about a completed analysis. Measurements stay backend-generated; the language model only interprets the supplied evidence.",
  },
  {
    title: "Open API",
    body: "Search Sentinel-2 and Landsat scenes, start an analysis, and read results from the documented FastAPI endpoints.",
  },
];

export default function HomePage() {
  return (
    <main style={{ minHeight: "100vh", padding: "56px 24px", display: "flex", justifyContent: "center" }}>
      <div style={{ width: "100%", maxWidth: 980 }}>
        <p style={{ margin: 0, color: "#9bd0a5", fontSize: 12, letterSpacing: 1.2, textTransform: "uppercase" }}>TerraMind AI</p>
        <h1 style={{ margin: "10px 0 14px", fontSize: "clamp(30px, 5vw, 46px)", lineHeight: 1.15 }}>Satellite change analysis you can trace back to evidence.</h1>
        <p style={{ margin: 0, maxWidth: 700, color: "#aabbb5", fontSize: 17, lineHeight: 1.65 }}>
          TerraMind AI compares real Earth Engine observations for vegetation, water, and built-up land surfaces. Every numeric finding is computed by the backend and linked to its dates, datasets, thresholds, and valid-pixel coverage.
        </p>

        <div style={{ marginTop: 32, display: "flex", flexWrap: "wrap", gap: 12 }}>
          <Link href="/explorer" style={{ padding: "12px 20px", borderRadius: 9, background: "#9bd0a5", color: "#10201b", fontWeight: 700, textDecoration: "none" }}>
            Open the explorer
          </Link>
          <a href={docsUrl} target="_blank" rel="noreferrer" style={{ padding: "12px 20px", borderRadius: 9, border: "1px solid #34534a", color: "#e5efeb", textDecoration: "none" }}>
            API documentation
          </a>
        </div>

        <section style={{ marginTop: 48, display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
          {cards.map(card => (
            <article key={card.title} style={{ padding: 20, border: "1px solid #29423c", borderRadius: 12, background: "#101b1b" }}>
              <h2 style={{ margin: "0 0 8px", fontSize: 17 }}>{card.title}</h2>
              <p style={{ margin: 0, color: "#aabbb5", fontSize: 14, lineHeight: 1.6 }}>{card.body}</p>
            </article>
          ))}
        </section>

        <p style={{ marginTop: 40, color: "#7f9990", fontSize: 13, lineHeight: 1.6 }}>
          Thresholded index changes are deterministic measurements, not calibrated probabilities. A negative NDVI difference is an index decrease, not proof of vegetation loss.
        </p>
        <p style={{ marginTop: 8, color: "#7f9990", fontSize: 13 }}>
          Backend: <a href={docsUrl} target="_blank" rel="noreferrer">{docsUrl}</a>
        </p>
      </div>
    </main>
  );
}
