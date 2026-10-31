"""Satellite catalog API. Processing helpers remain available to Module 5 in-process."""
from datetime import datetime, timezone

import ee
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from shapely.geometry import shape
from shapely.validation import explain_validity

from app.schemas.contracts import PrepareObservationRequest, SatelliteSearchRequest
from app.services.earth_engine.client import earth_engine_client
from app.services.earth_engine.errors import EarthEngineError
from app.services.earth_engine.settings import get_ee_settings

router = APIRouter(tags=["Satellite"])


def _validate_aoi(geojson):
    geometry = shape(geojson)
    if geometry.geom_type not in ("Polygon", "MultiPolygon") or geometry.is_empty or not geometry.is_valid:
        reason = explain_validity(geometry) if not geometry.is_empty else "geometry is empty"
        raise ValueError(f"AOI must be a valid non-empty Polygon or MultiPolygon: {reason}")
    minx, miny, maxx, maxy = geometry.bounds
    if minx < -180 or maxx > 180 or miny < -90 or maxy > 90:
        raise ValueError("AOI coordinates must be within longitude [-180, 180] and latitude [-90, 90]")
    if geometry.area == 0 or geometry.area > 100:
        raise ValueError("AOI is degenerate or implausibly large in WGS84 coordinate space")
    return geometry


@router.get("/earth-engine/status")
def earth_engine_status():
    return earth_engine_client.status()


@router.post("/satellite/search")
def satellite_search(payload: SatelliteSearchRequest):
    settings = get_ee_settings()
    days = (payload.end_date - payload.start_date).days
    if days > settings.max_search_days:
        return JSONResponse(status_code=422, content={"error": "date_range_too_large", "detail": f"Date range exceeds configured maximum of {settings.max_search_days} days"})
    try:
        _validate_aoi(payload.area_of_interest)
    except Exception as exc:
        return JSONResponse(status_code=422, content={"error": "invalid_area", "detail": str(exc)})
    try:
        geometry = ee.Geometry(payload.area_of_interest)
        earth_engine_client.initialize()
        area_sq_km = geometry.area(maxError=1000).divide(1_000_000).getInfo()
    except EarthEngineError:
        raise
    except Exception as exc:
        message = str(exc).lower()
        if any(term in message for term in ("quota", "rate limit", "429")):
            from app.services.earth_engine.errors import EarthEngineQuotaError
            raise EarthEngineQuotaError("Earth Engine quota or rate limit reached") from exc
        raise EarthEngineError("Earth Engine failed while validating the AOI") from exc
    if area_sq_km > settings.max_aoi_area_sq_km:
        return JSONResponse(status_code=422, content={"error": "invalid_area", "detail": f"AOI exceeds configured maximum of {settings.max_aoi_area_sq_km} sq km"})
    observations = earth_engine_client.search(payload, geometry)
    return {
        "observations": observations,
        "processing": {
            "provider": "Google Earth Engine",
            "requested_dataset": payload.dataset,
            "date_range": {"start_inclusive": payload.start_date.isoformat(), "end_exclusive": payload.end_date.isoformat()},
            "max_cloud_cover_percent": payload.max_cloud_cover,
            "aoi_area_sq_km": area_sq_km,
            "result_count": len(observations),
            "searched_at": datetime.now(timezone.utc).isoformat(),
            "missing_observations": not bool(observations),
        },
    }


@router.post("/satellite/preview")
def satellite_preview(payload: PrepareObservationRequest):
    """Return a lightweight authenticated EE true-colour tile reference for one real catalog image."""
    settings = get_ee_settings()
    try:
        aoi = _validate_aoi(payload.area_of_interest)
        geometry = ee.Geometry(payload.area_of_interest)
        earth_engine_client.initialize()
        area_sq_km = geometry.area(maxError=1000).divide(1_000_000).getInfo()
        if area_sq_km > settings.max_aoi_area_sq_km:
            return JSONResponse(status_code=422, content={"error": "invalid_area", "detail": "AOI exceeds configured maximum"})
        prepared = earth_engine_client.prepare_observation(payload.image_id, payload.dataset, geometry, target_scale_m=payload.target_scale_m, target_crs=payload.target_crs)
        image = prepared["image"]
        visualization = {"bands": ["red", "green", "blue"], "min": 0, "max": 0.3, "gamma": 1.2}
        map_info = image.getMapId(visualization)
    except EarthEngineError:
        raise
    except Exception as exc:
        return JSONResponse(status_code=422, content={"error": "preview_failed", "detail": str(exc)})
    return {
        "image_id": payload.image_id,
        "dataset": payload.dataset,
        "metadata": prepared["metadata"],
        "layer": {"name": "true_colour_preview", "map_id": map_info.get("mapid"), "tile_url_template": map_info["tile_fetcher"].url_format, "visualization": visualization},
    }
