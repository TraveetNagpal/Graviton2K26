"""Background analysis jobs with an in-memory tile cache and optional durable
PostgreSQL status/result records. Raster pixels remain external assets.
"""
from datetime import datetime, timezone
import json
import logging
from threading import RLock
from typing import Optional
from uuid import uuid4

from app.services.analysis.engine import VISUALIZATION, change_detection_engine
from app.services.earth_engine.errors import EarthEngineError
from app.core.config import get_settings
from fastapi import HTTPException

_jobs: dict[str, dict] = {}
_lock = RLock()
logger = logging.getLogger(__name__)


def _now():
    return datetime.now(timezone.utc).isoformat()



def submit(kind: str, request: dict, owner_id: Optional[int] = None) -> str:
    cache_key = json.dumps({"kind": kind, "request": request}, sort_keys=True, separators=(",", ":"), default=str)
    with _lock:
        for existing_id, existing in _jobs.items():
            same_owner = existing.get("owner_id") == owner_id
            if same_owner and existing.get("cache_key") == cache_key and existing.get("status") in ("accepted", "running", "completed"):
                return existing_id
        analysis_id = str(uuid4())
        request = dict(request)
        request["analysis_id"] = analysis_id
        _jobs[analysis_id] = {"analysis_id": analysis_id, "analysis_type": kind, "status": "accepted", "created_at": _now(), "request": request, "result": None, "layer_images": None, "error": None, "owner_id": owner_id, "cache_key": cache_key}
    if get_settings().persist_analysis_jobs:
        try:
            _persist_job(analysis_id, "accepted", kind, request, owner_id=owner_id)
        except Exception as exc:
            with _lock: _jobs.pop(analysis_id, None)
            logger.exception("Could not persist accepted analysis job %s", analysis_id)
            raise HTTPException(status_code=503, detail="Analysis storage is unavailable; no job was accepted") from exc
    return analysis_id


def _persist_job(analysis_id, status, kind=None, request=None, *, owner_id=None, result=None, error=None):
    from sqlalchemy import select
    from app.core.database import get_session_factory
    from app.models.schema import AnalysisJob, AnalysisResult
    with get_session_factory()() as db:
        row = db.get(AnalysisJob, analysis_id)
        if row is None:
            row = AnalysisJob(id=analysis_id, owner_id=owner_id, analysis_type=kind, status=status, request_json=request or {}, error_json=error)
            db.add(row)
        else:
            row.status = status; row.error_json = error
        if result is not None:
            saved = db.get(AnalysisResult, analysis_id)
            if saved is None: db.add(AnalysisResult(analysis_id=analysis_id, result_json=result, raster_asset_uris=[]))
            else: saved.result_json = result
        db.commit()


def run_job(analysis_id: str) -> None:
    with _lock:
        job = _jobs.get(analysis_id)
        if not job or job["status"] in ("running", "completed", "failed"):
            return
        job["status"] = "running"
        job["started_at"] = _now()
        request, kind = job["request"], job["analysis_type"]
        owner_id = job.get("owner_id")
    try:
        if get_settings().persist_analysis_jobs:
            _persist_job(analysis_id, "running", owner_id=owner_id)
        result = change_detection_engine.analyze(kind, request)
        layer_images = result.pop("_layer_images")
        with _lock:
            job["status"] = "completed"
            job["completed_at"] = _now()
            job["result"] = result
            job["layer_images"] = layer_images
        if get_settings().persist_analysis_jobs:
            _persist_job(analysis_id, "completed", result=result, owner_id=owner_id)
    except ValueError as exc:
        with _lock:
            job["status"] = "failed"
            job["completed_at"] = _now()
            job["error"] = {"code": "analysis_not_suitable", "detail": str(exc)}
        if get_settings().persist_analysis_jobs:
            try: _persist_job(analysis_id, "failed", error={"code": "analysis_not_suitable", "detail": str(exc)}, owner_id=owner_id)
            except Exception: logger.exception("Could not persist failed analysis state %s", analysis_id)
    except EarthEngineError as exc:
        with _lock:
            job["status"] = "failed"
            job["completed_at"] = _now()
            job["error"] = {"code": exc.code, "detail": str(exc)}
        if get_settings().persist_analysis_jobs:
            try: _persist_job(analysis_id, "failed", error={"code": exc.code, "detail": str(exc)}, owner_id=owner_id)
            except Exception: logger.exception("Could not persist failed analysis state %s", analysis_id)
    except Exception:
        logger.exception("Change analysis job failed: %s", analysis_id)
        with _lock:
            job["status"] = "failed"
            job["completed_at"] = _now()
            job["error"] = {"code": "analysis_failed", "detail": "The analysis failed during Earth Engine processing."}
        if get_settings().persist_analysis_jobs:
            try: _persist_job(analysis_id, "failed", error={"code": "analysis_failed", "detail": "The analysis failed during Earth Engine processing."}, owner_id=owner_id)
            except Exception: logger.exception("Could not persist failed analysis state %s", analysis_id)


def get_job(analysis_id: str):
    with _lock:
        job = _jobs.get(analysis_id)
        if job: return dict(job)
    if get_settings().persist_analysis_jobs:
        from app.core.database import get_session_factory
        from app.models.schema import AnalysisJob, AnalysisResult
        with get_session_factory()() as db:
            row = db.get(AnalysisJob, analysis_id)
            if not row: return None
            saved = db.get(AnalysisResult, analysis_id)
            return {"analysis_id": row.id, "analysis_type": row.analysis_type, "status": row.status, "created_at": row.created_at.isoformat() if row.created_at else None, "request": row.request_json, "result": saved.result_json if saved else None, "layer_images": None, "error": row.error_json, "owner_id": row.owner_id}
    return None


_LAYER_KINDS = ("vegetation", "water", "urban")


def _visualization(kind: str, name: str) -> dict:
    if name == "change":
        return VISUALIZATION[kind]
    if name in ("earlier_rgb", "later_rgb"):
        return {"bands": ["red", "green", "blue"], "min": 0.0, "max": 0.3}
    if name in ("earlier_index", "later_index"):
        return {"min": -1, "max": 1, "palette": ["#762a83", "#f7f7f7", "#1b7837"]}
    if name == "water_extent_later":
        return {"min": 0, "max": 1, "palette": ["#f7f7f7", "#2166ac"]}
    return {"min": -1, "max": 1, "palette": ["#f7f7f7", "#b2182b"]}


def _render_layer_tiles(kind: str, layer_images: dict):
    output = []
    for name, image in layer_images.items():
        visualization = _visualization(kind, name)
        map_info = image.getMapId(visualization)
        output.append({
            "name": name,
            "map_id": map_info.get("mapid"),
            "tile_url_template": map_info["tile_fetcher"].url_format,
            "visualization": visualization,
        })
    return output


def _rebuild_layer_images(job: dict) -> dict:
    """Earth Engine map ids are process-local, so rebuild them from the saved request.

    Persisted analyses keep their original numerical result; only the display
    images are recomputed when a new backend instance serves the layers endpoint.
    """
    kind = job.get("analysis_type")
    request = job.get("request")
    if kind not in _LAYER_KINDS or not isinstance(request, dict) or not request:
        return job
    try:
        rebuilt = change_detection_engine.analyze(kind, dict(request))
        layer_images = rebuilt.get("_layer_images")
    except Exception:
        logger.warning("Could not rebuild map layers for completed analysis %s", job.get("analysis_id"))
        return job
    if not layer_images:
        return job
    with _lock:
        cached = _jobs.get(job["analysis_id"])
        if cached is not None and cached.get("status") == "completed":
            cached["layer_images"] = layer_images
            return dict(cached)
    job = dict(job)
    job["layer_images"] = layer_images
    return job


def get_layer_tiles(analysis_id: str):
    with _lock:
        job = _jobs.get(analysis_id)
        if job is not None and job["status"] != "completed":
            return dict(job), "not_ready"
        if job is not None:
            job = dict(job)
    if job is None:
        job = get_job(analysis_id)
        if not job:
            return None, "not_found"
        if job["status"] != "completed":
            return job, "not_ready"
    if job.get("layer_images") is None:
        job = _rebuild_layer_images(job)
    if job.get("layer_images") is None:
        return job, "layers_unavailable"
    try:
        return _render_layer_tiles(job["analysis_type"], job["layer_images"]), "ready"
    except Exception:
        logger.exception("Could not generate map tiles for analysis %s", analysis_id)
        return job, "layers_unavailable"


def run_trend_job(analysis_id: str) -> None:
    """Compare each selected real observation with a common baseline."""
    with _lock:
        job = _jobs.get(analysis_id)
        if not job or job["status"] in ("running", "completed", "failed"):
            return
        job["status"] = "running"
        job["started_at"] = _now()
        request = dict(job["request"])
        owner_id = job.get("owner_id")
    try:
        kind = request["analysis_type"]
        observations = request["observations"]
        by_id = {item["image_id"]: item for item in observations}
        baseline = by_id[request["baseline_image_id"]]
        common = {key: value for key, value in request.items() if key not in ("observations", "analysis_type", "baseline_image_id", "analysis_id")}
        points = []
        baseline_values = None
        for observation in observations:
            if observation["image_id"] == baseline["image_id"]:
                continue
            pair_request = dict(common)
            is_before_baseline = observation["date"] < baseline["date"]
            first, second = (observation, baseline) if is_before_baseline else (baseline, observation)
            pair_request.update({"earlier_image_id": first["image_id"], "earlier_dataset": first["dataset"], "later_image_id": second["image_id"], "later_dataset": second["dataset"]})
            sub_id = submit(kind, pair_request, owner_id=owner_id)
            sub_job = get_job(sub_id)
            if sub_job and sub_job["status"] not in ("completed", "failed"):
                run_job(sub_id)
                sub_job = get_job(sub_id)
            if not sub_job or sub_job["status"] != "completed":
                points.append({"date": observation["date"], "image_id": observation["image_id"], "dataset": observation["dataset"], "status": "unavailable", "analysis_id": sub_id, "value": None, "warning": (sub_job or {}).get("error", {}).get("detail", "No valid analysis result was produced.")})
                continue
            result = sub_job["result"]
            m = result["measurements"]
            actual_first_date = result.get("observation_dates", {}).get("earlier", first["date"])
            actual_second_date = result.get("observation_dates", {}).get("later", second["date"])
            actual_baseline_date = actual_second_date if is_before_baseline else actual_first_date
            actual_observation_date = actual_first_date if is_before_baseline else actual_second_date
            source_metadata = result.get("datasets", {})
            baseline_source = source_metadata.get("later" if is_before_baseline else "earlier")
            observation_source = source_metadata.get("earlier" if is_before_baseline else "later")
            if actual_baseline_date != baseline["date"] or actual_observation_date != observation["date"]:
                warnings_note = "Submitted catalog date did not match the date resolved from the Earth Engine asset; Earth Engine asset dates are used."
            else:
                warnings_note = None
            if baseline_values is None:
                baseline_values = _trend_value(kind, m, earlier=not is_before_baseline)
                baseline_layer = "later_index" if is_before_baseline else "earlier_index"
                baseline_point = {"date": actual_baseline_date, "image_id": baseline["image_id"], "dataset": baseline["dataset"], "source_metadata": baseline_source, "status": "completed", "analysis_id": sub_id, "value": baseline_values, "valid_pixel_coverage_percent": result["valid_pixel_coverage_percent"], "quality_warnings": result["quality_warnings"], "layer_url": f"/api/analysis/{sub_id}/layers", "layer_name": baseline_layer}
                if warnings_note:
                    baseline_point["warning"] = warnings_note
                points.append(baseline_point)
            change = _trend_change(kind, m)
            if is_before_baseline and change.get("value") is not None:
                change["value"] = -change["value"]
            layer_name = "earlier_index" if is_before_baseline else ("later_index" if kind == "vegetation" else ("water_extent_later" if kind == "water" else "built_up_proxy_later"))
            observation_point = {"date": actual_observation_date, "image_id": observation["image_id"], "dataset": observation["dataset"], "source_metadata": observation_source, "status": "completed", "analysis_id": sub_id, "value": _trend_value(kind, m, earlier=is_before_baseline), "change_from_baseline": change, "valid_pixel_coverage_percent": result["valid_pixel_coverage_percent"], "quality_warnings": result["quality_warnings"], "layer_url": f"/api/analysis/{sub_id}/layers", "layer_name": layer_name}
            if warnings_note:
                observation_point["warning"] = warnings_note
            points.append(observation_point)
        if baseline_values is None:
            points.append({"date": baseline["date"], "image_id": baseline["image_id"], "dataset": baseline["dataset"], "status": "unavailable", "value": None, "warning": "No valid baseline comparison was completed."})
        points.sort(key=lambda point: point["date"])
        warnings = ["Each date pair uses its own shared QA-valid pixels; changing spatial support can affect apparent trends even though the same preprocessing method is used."]
        datasets = {point["dataset"] for point in points}
        sensors = {"/".join(point["image_id"].split("/")[:2]) for point in points}
        if len(datasets) > 1 or len(sensors) > 1:
            warnings.append("The trend combines multiple sensors/datasets; cross-sensor differences can affect comparability.")
        dates_by_month = {point["date"][5:7] for point in points if point["status"] == "completed"}
        if len(dates_by_month) > 1:
            warnings.append("Observation season varies across dates; seasonal vegetation and water cycles can affect comparisons.")
        if any(point["status"] != "completed" for point in points):
            warnings.append("Some actual observations could not produce valid measurements and are shown as unavailable, not zero.")
        result = {"analysis_id": analysis_id, "analysis_type": "trend", "metric_analysis_type": kind, "status": "completed", "baseline": {"date": next((point["date"] for point in points if point["image_id"] == baseline["image_id"]), baseline["date"]), "image_id": baseline["image_id"]}, "points": points, "quality_warnings": warnings, "measurement_definition": _trend_definition(kind), "missing_observation_count": sum(point["status"] != "completed" for point in points)}
        with _lock:
            job = _jobs[analysis_id]
            job["status"] = "completed"
            job["completed_at"] = _now()
            job["result"] = result
    except Exception:
        logger.exception("Historical trend job failed: %s", analysis_id)
        with _lock:
            job = _jobs[analysis_id]
            job["status"] = "failed"
            job["completed_at"] = _now()
            job["error"] = {"code": "trend_failed", "detail": "The historical trend analysis failed."}


def _trend_value(kind, measurements, *, earlier):
    if kind == "vegetation":
        key = "mean_ndvi_earlier" if earlier else "mean_ndvi_later"
        return {"metric": "mean_ndvi", "value": measurements.get(key), "unit": "index"}
    if kind == "water":
        key = "mapped_water_area_earlier_ha" if earlier else "mapped_water_area_later_ha"
        return {"metric": "mapped_water_area", "value": measurements.get(key), "unit": "hectares"}
    key = "mapped_built_up_proxy_area_earlier_ha" if earlier else "mapped_built_up_proxy_area_later_ha"
    return {"metric": "mapped_built_up_proxy_area", "value": measurements.get(key), "unit": "hectares"}


def _trend_change(kind, measurements):
    if kind == "vegetation":
        return {"metric": "mean_ndvi_difference", "value": measurements.get("mean_ndvi_difference"), "unit": "index"}
    if kind == "water":
        return {"metric": "net_mapped_water_area_change", "value": measurements.get("net_mapped_water_area_change_m2"), "unit": "square_metres"}
    return {"metric": "net_mapped_built_up_proxy_change", "value": measurements.get("net_mapped_built_up_proxy_change_ha"), "unit": "hectares"}


def _trend_definition(kind):
    return {"vegetation": "Mean AOI NDVI from the paired masked analysis grid; change is later minus baseline.", "water": "Threshold-mapped water area in hectares on the paired valid mask; change is later minus baseline.", "urban": "Threshold-mapped NDBI built-up proxy area in hectares; this is not a building count."}[kind]
