export default function HomePage() {
  return <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "radial-gradient(ellipse at top right, #193b31, #0b1413 60%)", padding: 24 }}>
    <section style={{ maxWidth: 760 }}><div style={{ color: "#9bd0a5", letterSpacing: 2, textTransform: "uppercase", fontSize: 13 }}>TerraMind AI</div><h1 style={{ fontSize: "clamp(40px, 8vw, 76px)", margin: "14px 0", lineHeight: 1 }}>Earth, measured over time.</h1><p style={{ color: "#aabbb5", fontSize: 18, lineHeight: 1.65 }}>Search real satellite observations, compare vegetation, water, and built-up proxies against a selected baseline, and inspect each mapped result.</p><a href="/explorer" style={{ display: "inline-block", marginTop: 18, padding: "13px 18px", borderRadius: 9, color: "#10201b", background: "#9bd0a5", fontWeight: 700, textDecoration: "none" }}>Open historical explorer →</a></section>
  </main>;
}
