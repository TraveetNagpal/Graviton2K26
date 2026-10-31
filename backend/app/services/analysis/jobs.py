"""Process-local background job registry for change analyses.

Results are volatile across worker restarts; production deployments should back
this interface with the project's durable database and task queue.
"""
from datetime import datetime, timezone
import logging
from threading import RLock
from uuid import uuid4

from app.services.analysis.engine import VISUALIZATION, change_detection_engine
from app.services.earth_engine.errors import EarthEngineError

_jobs: dict[str, dict] = {}
_lock = RLock()
logger = logging.getLogger(__name__)


def _now():
    return datetime.now(timezone.utc).isoformat()


def submit(kind: str, request: dict) -> str:
    analysis_id = str(uuid4())
    request = dict(request)
    request["analysis_id"] = analysis_id
    with _lock:
        _jobs[analysis_id] = {"analysis_id": analysis_id, "analysis_type": kind, "status": "accepted", "created_at": _now(), "request": request, "result": None, "layer_images": None, "error": None}
    return analysis_id


def run_job(analysis_id: str) -> None:
    with _lock:
        job = _jobs.get(analysis_id)
        if not job:
            return
        job["status"] = "running"
        job["started_at"] = _now()
        request, kind = job["request"], job["analysis_type"]
    try:
        result = change_detection_engine.analyze(kind, request)
        layer_images = result.pop("_layer_images")
        with _lock:
            job["status"] = "completed"
            job["completed_at"] = _now()
            job["result"] = result
            job["layer_images"] = layer_images
    except ValueError as exc:
        with _lock:
            job["status"] = "failed"
            job["completed_at"] = _now()
            job["error"] = {"code": "analysis_not_suitable", "detail": str(exc)}
    except EarthEngineError as exc:
        with _lock:
            job["status"] = "failed"
            job["completed_at"] = _now()
            job["error"] = {"code": exc.code, "detail": str(exc)}
    except Exception:
        logger.exception("Change analysis job failed: %s", analysis_id)
        with _lock:
            job["status"] = "failed"
            job["completed_at"] = _now()
            job["error"] = {"code": "analysis_failed", "detail": "The analysis failed during Earth Engine processing."}


def get_job(analysis_id: str):
    with _lock:
        job = _jobs.get(analysis_id)
        return dict(job) if job else None


def get_layer_tiles(analysis_id: str):
    with _lock:
        job = _jobs.get(analysis_id)
        if not job:
            return None, "not_found"
        if job["status"] != "completed":
            return job, "not_ready"
        layer_images = dict(job["layer_images"])
        kind = job["analysis_type"]
    output = []
    for name, image in layer_images.items():
        if name == "change":
            visualization = VISUALIZATION[kind]
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
