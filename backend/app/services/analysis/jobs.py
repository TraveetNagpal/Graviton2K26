"""Background analysis jobs with an in-memory tile cache and optional durable
PostgreSQL status/result records. Raster pixels remain external assets.
"""
from datetime import datetime, timezone
import logging
from threading import RLock
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


def submit(kind: str, request: dict, owner_id: int | None = None) -> str:
    analysis_id = str(uuid4())
    request = dict(request)
    request["analysis_id"] = analysis_id
    with _lock:
        _jobs[analysis_id] = {"analysis_id": analysis_id, "analysis_type": kind, "status": "accepted", "created_at": _now(), "request": request, "result": None, "layer_images": None, "error": None, "owner_id": owner_id}
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
        if not job:
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


def get_layer_tiles(analysis_id: str):
    with _lock:
        job = _jobs.get(analysis_id)
        if not job:
            job = None
        if job is None:
            pass
        elif job["status"] != "completed":
            return job, "not_ready"
        elif job.get("layer_images") is None:
            return job, "layers_unavailable"
        else:
            layer_images = dict(job["layer_images"])
            kind = job["analysis_type"]
    if job is None:
        persisted = get_job(analysis_id)
        if not persisted:
            return None, "not_found"
        if persisted["status"] != "completed":
            return persisted, "not_ready"
        return persisted, "layers_unavailable"
    output = []
    for name, image in layer_images.items():
        if name == "change":
            visualization = VISUALIZATION[kind]
        elif name in ("earlier_rgb", "later_rgb"):
            visualization = {"bands": ["red", "green", "blue"], "min": 0.0, "max": 0.3}
        elif name in ("earlier_index", "later_index"):
            visualization = {"min": -1, "max": 1, "palette": ["#762a83", "#f7f7f7", "#1b7837"]}
        elif name == "water_extent_later":
            visualization = {"min": 0, "max": 1, "palette": ["#f7f7f7", "#2166ac"]}
        else:
            visualization = {"min": -1, "max": 1, "palette": ["#f7f7f7", "#b2182b"]}
        map_info = image.getMapId(visualization)
        output.append({
            "name": name,
            "map_id": map_info.get("mapid"),
            "tile_url_template": map_info["tile_fetcher"].url_format,
            "visualization": visualization,
        })
    return output, "ready"
