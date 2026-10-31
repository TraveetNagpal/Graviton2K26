"""Asynchronous API for vegetation, water, and urban change analysis."""
from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import JSONResponse
from shapely.geometry import shape
from shapely.validation import explain_validity

from app.schemas.contracts import VegetationAnalysisRequest, WaterAnalysisRequest, UrbanAnalysisRequest
from app.services.analysis.jobs import get_job, get_layer_tiles, run_job, submit

router = APIRouter(prefix="/analysis", tags=["Change analysis"])


def _submit(kind, payload, background_tasks):
    try:
        geometry = shape(payload.area_of_interest)
        if geometry.geom_type not in ("Polygon", "MultiPolygon") or geometry.is_empty or not geometry.is_valid:
            reason = explain_validity(geometry) if not geometry.is_empty else "geometry is empty"
            raise ValueError(f"AOI must be a valid non-empty Polygon or MultiPolygon: {reason}")
        minx, miny, maxx, maxy = geometry.bounds
        if minx < -180 or maxx > 180 or miny < -90 or maxy > 90:
            raise ValueError("AOI coordinates must be within WGS84 bounds")
        if geometry.area <= 0 or geometry.area > 100:
            raise ValueError("AOI is degenerate or implausibly large in WGS84 coordinate space")
    except Exception as exc:
        raise HTTPException(status_code=422, detail={"error": "invalid_area", "detail": str(exc)}) from exc
    request = payload.model_dump(mode="json")
    analysis_id = submit(kind, request)
    background_tasks.add_task(run_job, analysis_id)
    return JSONResponse(status_code=202, content={
        "analysis_id": analysis_id,
        "analysis_type": kind,
        "status": "accepted",
        "status_url": f"/api/analysis/{analysis_id}",
        "layers_url": f"/api/analysis/{analysis_id}/layers",
    })


@router.post("/vegetation", status_code=202)
def analyze_vegetation(payload: VegetationAnalysisRequest, background_tasks: BackgroundTasks):
    """Measure NDVI change. Negative differences indicate index decrease, not proof of vegetation loss."""
    return _submit("vegetation", payload, background_tasks)


@router.post("/water", status_code=202)
def analyze_water(payload: WaterAnalysisRequest, background_tasks: BackgroundTasks):
    """Measure McFeeters NDWI water extent change using the configured threshold."""
    return _submit("water", payload, background_tasks)


@router.post("/urban", status_code=202)
def analyze_urban(payload: UrbanAnalysisRequest, background_tasks: BackgroundTasks):
    """Measure NDBI built-up proxy change; does not detect individual buildings."""
    return _submit("urban", payload, background_tasks)


@router.get("/{analysis_id}")
def get_analysis(analysis_id: str):
    job = get_job(analysis_id)
    if not job:
        raise HTTPException(status_code=404, detail="Analysis not found")
    response = {key: value for key, value in job.items() if key not in ("request", "layer_images")}
    if job["status"] == "completed":
        response.update(job["result"])
    return response


@router.get("/{analysis_id}/layers")
def get_analysis_layers(analysis_id: str):
    result, state = get_layer_tiles(analysis_id)
    if state == "not_found":
        raise HTTPException(status_code=404, detail="Analysis not found")
    if state == "not_ready":
        if result["status"] == "failed":
            raise HTTPException(status_code=409, detail={"status": "failed", "error": result["error"]})
        return JSONResponse(status_code=202, content={"analysis_id": analysis_id, "status": result["status"], "layers": []})
    return {"analysis_id": analysis_id, "status": "completed", "layers": result}
