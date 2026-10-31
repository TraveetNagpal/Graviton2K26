"""Compact, provenance-first PDF report renderer for completed analyses."""
from io import BytesIO
from html import escape
from pathlib import Path
from typing import Optional
import reportlab
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image
from shapely.geometry import shape


def build_analysis_pdf(title: str, result: dict, report_id: str, thumbnails: Optional[dict[str, bytes]] = None) -> bytes:
    stream = BytesIO()
    styles = getSampleStyleSheet()
    font_path = Path(reportlab.__file__).parent / "fonts" / "Vera.ttf"
    if "TerraVera" not in pdfmetrics.getRegisteredFontNames():
        pdfmetrics.registerFont(TTFont("TerraVera", str(font_path)))
    for style in styles.byName.values():
        style.fontName = "TerraVera"
    doc = SimpleDocTemplate(stream, pagesize=letter, rightMargin=48, leftMargin=48, topMargin=48, bottomMargin=48)
    story = [Paragraph(escape(title), styles["Title"]), Paragraph(escape(f"Report {report_id} · Analysis {result.get('analysis_id', '—')}"), styles["Normal"]), Spacer(1, 16)]
    story.append(Paragraph("Analysis provenance", styles["Heading2"]))
    dates = result.get("observation_dates") or {}
    datasets = result.get("datasets") or {}
    earlier, later = datasets.get("earlier") or {}, datasets.get("later") or {}
    facts = [
        ["Geographic region", _region_label(result.get("region"))],
        ["Analysis type", str(result.get("analysis_type", "—"))],
        ["Observation dates", f"{dates.get('earlier', '—')} to {dates.get('later', '—')}"],
        ["Earlier observation", str(earlier.get("image_id", "—"))],
        ["Later observation", str(later.get("image_id", "—"))],
        ["Dataset", f"{earlier.get('dataset', '—')} / {later.get('dataset', '—')}"],
        ["Method", str(result.get("analysis_method", "—"))],
        ["Processed at (UTC)", str(result.get("created_at", "—"))],
        ["Valid pixel coverage", f"{result.get('valid_pixel_coverage_percent', '—')}%"],
    ]
    table = Table(facts, colWidths=[145, 365], repeatRows=0)
    table.setStyle(TableStyle([("FONTNAME", (0,0), (-1,-1), "TerraVera"), ("BACKGROUND", (0,0), (0,-1), colors.HexColor("#eaf2f4")), ("GRID", (0,0), (-1,-1), .35, colors.HexColor("#c8d5da")), ("VALIGN", (0,0), (-1,-1), "TOP"), ("PADDING", (0,0), (-1,-1), 7)]))
    story.extend([table, Spacer(1, 18)])
    story.extend([Spacer(1, 12), Paragraph("Observation sources", styles["Heading2"])])
    sources = [["Role", "Observation date", "Dataset", "Earth Engine asset"]]
    for label, metadata in (("Before", earlier), ("After", later)):
        sources.append([label, str(metadata.get("date", "—")), str(metadata.get("dataset", "—")), str(metadata.get("image_id", "—"))])
    source_table = Table(sources, colWidths=[50, 90, 90, 280], repeatRows=1)
    source_table.setStyle(TableStyle([("FONTNAME", (0,0), (-1,-1), "TerraVera"), ("BACKGROUND", (0,0), (-1,0), colors.HexColor("#d9edf1")), ("GRID", (0,0), (-1,-1), .35, colors.HexColor("#c8d5da")), ("VALIGN", (0,0), (-1,-1), "TOP"), ("FONTSIZE", (0,0), (-1,-1), 7), ("PADDING", (0,0), (-1,-1), 5)]))
    story.extend([source_table, Spacer(1, 10), Paragraph(f"Supporting raster layers: {result.get('change_layer', {}).get('layers_endpoint', 'not available')}", styles["BodyText"])])
    if thumbnails:
        story.extend([Spacer(1, 10), Paragraph("Before and after satellite composites", styles["Heading2"]), Paragraph("QA-masked natural-colour reflectance (red, green, blue); display stretch 0.0 to 0.3.", styles["BodyText"]), Spacer(1, 6)])
        images = []
        for key, label in (("earlier_rgb", "Before observation"), ("later_rgb", "After observation")):
            if thumbnails.get(key):
                images.append([Paragraph(label, styles["BodyText"]), Image(BytesIO(thumbnails[key]), width=230, height=145)])
        if images:
            story.append(Table(images, colWidths=[100, 245], style=TableStyle([("VALIGN", (0,0), (-1,-1), "MIDDLE"), ("BOTTOMPADDING", (0,0), (-1,-1), 8)])))
    if result.get("analysis_type") == "vegetation":
        story.extend([Spacer(1, 8), Paragraph("Change map legend: red (#b2182b) = NDVI decrease; white (#f7f7f7) = near zero change; green (#1a9850) = NDVI increase. The map range is -0.5 to +0.5 NDVI.", styles["BodyText"])])
    measurements = result.get("measurements") or {}
    story.extend([Spacer(1, 12), Paragraph("Numerical measurements", styles["Heading2"])])
    if measurements:
        rows = [["Measurement", "Value", "Unit"]]
        for key, value in measurements.items():
            unit = "ha" if key.endswith("_ha") else "m²" if key.endswith("_m2") else "index / threshold"
            rows.append([str(key).replace("_", " "), "—" if value is None else str(value), unit])
        data = Table(rows, colWidths=[270, 130, 110], repeatRows=1)
        data.setStyle(TableStyle([("FONTNAME", (0,0), (-1,-1), "TerraVera"), ("BACKGROUND", (0,0), (-1,0), colors.HexColor("#d9edf1")), ("GRID", (0,0), (-1,-1), .35, colors.HexColor("#c8d5da")), ("PADDING", (0,0), (-1,-1), 6)]))
        story.append(data)
    else:
        story.append(Paragraph("No tabular measurements were returned.", styles["BodyText"]))
    story.extend([Spacer(1, 16), Paragraph("Method and limitations", styles["Heading2"]), Paragraph(escape(str(result.get("analysis_method", "Method not supplied."))), styles["BodyText"])])
    if result.get("interpretation"):
        story.extend([Spacer(1, 10), Paragraph("AI interpretation", styles["Heading2"]), Paragraph(escape(str(result["interpretation"])), styles["BodyText"])])
    uncertainty = result.get("uncertainty") or {}
    if uncertainty.get("description"):
        story.append(Paragraph(escape(str(uncertainty["description"])), styles["BodyText"]))
    warnings = result.get("quality_warnings") or []
    if warnings:
        story.append(Paragraph("Data quality", styles["Heading2"]))
        story.extend(Paragraph(f"• {escape(str(warning))}", styles["BodyText"]) for warning in warnings)
    story.append(Spacer(1, 14))
    story.append(Paragraph("The before/after observations are identified by their Earth Engine asset IDs above. Raster imagery is served by the supporting layers endpoint and is not represented as vector data in this PDF. This report includes only results returned by the analysis backend; no absent measurement is interpreted as zero.", styles["Italic"]))
    def footer(canvas, document):
        canvas.saveState(); canvas.setFont("Helvetica", 8); canvas.setFillColor(colors.grey)
        canvas.drawString(48, 28, f"TerraMind AI · Source analysis {result.get('analysis_id', '—')}")
        canvas.drawRightString(letter[0]-48, 28, f"Page {document.page}"); canvas.restoreState()
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return stream.getvalue()


def _region_label(geojson):
    if not geojson:
        return "Region geometry not present in result"
    try:
        geometry = shape(geojson)
        west, south, east, north = geometry.bounds
        return f"{geometry.geom_type}; WGS84 bounds [{west:.5f}, {south:.5f}, {east:.5f}, {north:.5f}]"
    except Exception:
        return "Region geometry supplied; bounds unavailable"
