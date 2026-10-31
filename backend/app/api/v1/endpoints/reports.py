"""Private report artifacts built from completed analysis results."""
import csv
import asyncio
from datetime import datetime, timezone
from io import StringIO
from pathlib import Path
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, Response
import httpx
import ee
import logging
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.api.deps import get_workspace_user
from app.models.schema import Report, User
from app.services.analysis.jobs import get_job
from app.services.reports.pdf_builder import build_analysis_pdf, _region_label
from app.services.ai.investigator import explain

router = APIRouter(prefix="/reports", tags=["Reports"])
logger = logging.getLogger(__name__)

class GenerateReportRequest(BaseModel):
    analysis_id: str = Field(min_length=1, max_length=100)
    title: Optional[str] = Field(default=None, max_length=250)
    formats: list[str] = Field(default_factory=lambda: ["pdf", "csv"])

def _metadata(report: Report) -> dict:
    return report.metadata_json

def _report_thumbnails(job: dict) -> dict[str, bytes]:
    images = job.get("layer_images") or {}
    if not images or not job.get("result", {}).get("region"):
        return {}
    output = {}
    try:
        region = ee.Geometry(job["result"]["region"])
        with httpx.Client(timeout=20) as client:
            for key in ("earlier_rgb", "later_rgb"):
                image = images.get(key)
                if image is None: continue
                url = image.getThumbURL({"region": region, "dimensions": 640, "format": "png", "bands": ["red", "green", "blue"], "min": 0, "max": 0.3})
                response = client.get(url); response.raise_for_status()
                if not response.headers.get("content-type", "").lower().startswith("image/png"):
                    raise ValueError("Earth Engine did not return a PNG thumbnail")
                output[key] = response.content
    except Exception:
        # Numeric report generation remains valid if thumbnail rendering is unavailable.
        logger.warning("Source imagery thumbnails were unavailable for a report")
        return output
    return output

@router.post("/generate", status_code=201)
def generate_report(payload: GenerateReportRequest, user: User = Depends(get_workspace_user), db: Session = Depends(get_db)):
    job = get_job(payload.analysis_id)
    if not job:
        raise HTTPException(status_code=404, detail="Source analysis not found")
    if job.get("owner_id") != user.id:
        raise HTTPException(status_code=404, detail="Source analysis not found")
    if job["status"] != "completed" or not job.get("result"):
        raise HTTPException(status_code=409, detail=f"Source analysis is {job['status']}; a report requires a completed result")
    requested = set(payload.formats)
    if not requested or requested - {"pdf", "csv", "geojson"}:
        raise HTTPException(status_code=422, detail="Supported formats are pdf, csv, geojson")
    if "geojson" in requested:
        raise HTTPException(status_code=422, detail="This analysis returns raster layers, not compatible vector output")
    result = job["result"]
    report_id = str(uuid4())
    title = payload.title or f"{result.get('analysis_type', 'Analysis').title()} report"
    evidence = {key: result.get(key) for key in ("analysis_id", "analysis_type", "region", "observation_dates", "datasets", "analysis_method", "parameters", "measurements", "valid_pixel_coverage_percent", "quality_warnings", "uncertainty")}
    try:
        interpretation, interpretation_status = asyncio.run(explain("Summarize the observed change and its limitations.", evidence))
    except Exception:
        interpretation, interpretation_status = "Automated interpretation is unavailable; refer to measured results and limitations.", "unavailable"
    report_result = {**result, "interpretation": interpretation, "interpretation_status": interpretation_status}
    directory = Path(get_settings().report_storage_dir).resolve()
    thumbnails = _report_thumbnails(job) if "pdf" in requested else {}
    try:
        directory.mkdir(parents=True, exist_ok=True)
        if "pdf" in requested:
            (directory / f"{report_id}.pdf").write_bytes(build_analysis_pdf(title, report_result, report_id, thumbnails))
        if "csv" in requested:
            output = StringIO(); writer = csv.writer(output); writer.writerow(["measurement", "value", "unit"])
            for key, value in (result.get("measurements") or {}).items():
                if value is not None:
                    writer.writerow([key, value, "ha" if key.endswith("_ha") else "m2" if key.endswith("_m2") else "index"])
            (directory / f"{report_id}.csv").write_text(output.getvalue(), encoding="utf-8")
        analysis_dates = result.get("observation_dates") or {}
        datasets = result.get("datasets") or {}
        record = {
            "id": report_id, "title": title, "region": result.get("region_name") or _region_label(result.get("region")),
            "createdAt": datetime.now(timezone.utc).isoformat(), "analysisType": result.get("analysis_type", "unknown"),
            "status": "completed", "observationDates": [v for v in analysis_dates.values() if v],
            "analysisMethod": result.get("analysis_method"),
            "dataset": ", ".join(sorted({str((x or {}).get("dataset")) for x in datasets.values() if (x or {}).get("dataset")})),
            "measurements": [{"name": k, "value": v, "unit": "ha" if k.endswith("_ha") else "m²" if k.endswith("_m2") else "index"} for k, v in (result.get("measurements") or {}).items()],
            "geojsonAvailable": False, "sourceAnalysisId": payload.analysis_id,
            "formats": sorted(requested & {"pdf", "csv"}), "interpretationStatus": interpretation_status,
            "beforeAfterImagesIncluded": "earlier_rgb" in thumbnails and "later_rgb" in thumbnails,
        }
        row = Report(id=report_id, owner_id=user.id, analysis_id=payload.analysis_id, title=title, status="completed", artifact_uri=str(directory), geojson_available=False, metadata_json=record)
        db.add(row); db.commit()
        return {"report": record}
    except Exception as exc:
        db.rollback()
        for suffix in ("pdf", "csv"):
            (directory / f"{report_id}.{suffix}").unlink(missing_ok=True)
        if isinstance(exc, HTTPException): raise
        try:
            failure_record = {"id": report_id, "title": title, "createdAt": datetime.now(timezone.utc).isoformat(), "analysisType": result.get("analysis_type"), "status": "failed", "sourceAnalysisId": payload.analysis_id, "formats": [], "error": "Artifact generation failed"}
            db.add(Report(id=report_id, owner_id=user.id, analysis_id=payload.analysis_id, title=title, status="failed", artifact_uri=None, geojson_available=False, metadata_json=failure_record, error="Artifact generation failed"))
            db.commit()
        except Exception:
            db.rollback()
        raise HTTPException(status_code=500, detail="Report generation failed; its error status was recorded when storage was available") from exc

@router.get("")
def list_reports(user: User = Depends(get_workspace_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(Report).where(Report.owner_id == user.id).order_by(Report.created_at.desc())).all()
    return {"reports": [_metadata(row) for row in rows]}

@router.get("/{report_id}")
def get_report(report_id: str, user: User = Depends(get_workspace_user), db: Session = Depends(get_db)):
    row = db.scalar(select(Report).where(Report.id == report_id, Report.owner_id == user.id))
    if not row: raise HTTPException(status_code=404, detail="Report not found")
    return {"report": _metadata(row)}

@router.get("/{report_id}/download")
def download_report(report_id: str, format: str = Query(pattern="^(pdf|csv|geojson)$"), user: User = Depends(get_workspace_user), db: Session = Depends(get_db)):
    row = db.scalar(select(Report).where(Report.id == report_id, Report.owner_id == user.id))
    if not row: raise HTTPException(status_code=404, detail="Report not found")
    metadata = _metadata(row)
    if format == "geojson":
        raise HTTPException(status_code=422, detail="This analysis has raster layers but no compatible vector output")
    if format not in metadata.get("formats", []):
        raise HTTPException(status_code=404, detail="Requested format is unavailable")
    path = Path(row.artifact_uri or "") / f"{report_id}.{format}"
    if not path.is_file(): raise HTTPException(status_code=410, detail="Report artifact is unavailable")
    media_type = "application/pdf" if format == "pdf" else "text/csv"
    return FileResponse(path, media_type=media_type, filename=f"{report_id}.{format}")
