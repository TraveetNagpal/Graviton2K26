"""Scheduled, persisted monitoring over real Earth Engine catalog observations."""
from __future__ import annotations

import hashlib
import logging
from datetime import date, datetime, timedelta, timezone
from threading import Lock
from uuid import uuid4

import ee

from app.schemas.contracts import SatelliteSearchRequest
from app.services.analysis.jobs import get_job, run_job, submit
from app.services.earth_engine.client import earth_engine_client
from app.services.earth_engine.errors import EarthEngineAuthenticationError, EarthEngineQuotaError
from app.services.earth_engine.settings import get_ee_settings
from . import store
from .notifications import send_email_if_configured

logger = logging.getLogger(__name__)
_run_lock = Lock()


def _dump_monitor(row):
    if row is None:
        return None
    item = dict(row)
    item["config"] = store.decoded(row, "config", {})
    return item


def create_monitor(payload: dict):
    store.init_store()
    monitor_id = str(uuid4())
    now = datetime.now(timezone.utc)
    next_run = now + timedelta(minutes=payload["schedule_interval_minutes"])
    with store.connect() as db:
        db.execute("INSERT INTO monitors(id,name,config,status,created_at,updated_at,next_run_at) VALUES(?,?,?,'active',?,?,?)", (monitor_id, payload["name"], store.json_dump(payload), now.isoformat(), now.isoformat(), next_run.isoformat()))
        row = db.execute("SELECT * FROM monitors WHERE id=?", (monitor_id,)).fetchone()
    return _dump_monitor(row)


def list_monitors():
    store.init_store()
    with store.connect() as db:
        return [_dump_monitor(r) for r in db.execute("SELECT * FROM monitors ORDER BY created_at DESC")]


def get_monitor(monitor_id):
    store.init_store()
    with store.connect() as db:
        return _dump_monitor(db.execute("SELECT * FROM monitors WHERE id=?", (monitor_id,)).fetchone())


def update_monitor(monitor_id, changes):
    monitor = get_monitor(monitor_id)
    if not monitor:
        return None
    config = monitor["config"]
    config.update(changes)
    now = datetime.now(timezone.utc)
    next_run = now + timedelta(minutes=config["schedule_interval_minutes"])
    reset_baseline = bool({"area_of_interest", "dataset", "analysis_type"}.intersection(changes))
    with store.connect() as db:
        if reset_baseline:
            db.execute("UPDATE monitors SET name=?,config=?,updated_at=?,next_run_at=?,baseline_date=NULL,baseline_image_id=NULL,baseline_dataset=NULL WHERE id=?", (config["name"], store.json_dump(config), now.isoformat(), next_run.isoformat(), monitor_id))
        else:
            db.execute("UPDATE monitors SET name=?,config=?,updated_at=?,next_run_at=? WHERE id=?", (config["name"], store.json_dump(config), now.isoformat(), next_run.isoformat(), monitor_id))
        row = db.execute("SELECT * FROM monitors WHERE id=?", (monitor_id,)).fetchone()
    return _dump_monitor(row)


def set_monitor_status(monitor_id, status):
    store.init_store()
    next_run = datetime.now(timezone.utc).isoformat()
    with store.connect() as db:
        cursor = db.execute("UPDATE monitors SET status=?,updated_at=?,next_run_at=? WHERE id=?", (status, next_run, next_run, monitor_id))
        return _dump_monitor(db.execute("SELECT * FROM monitors WHERE id=?", (monitor_id,)).fetchone()) if cursor.rowcount else None


def delete_monitor(monitor_id):
    store.init_store()
    with store.connect() as db:
        cursor = db.execute("DELETE FROM monitors WHERE id=?", (monitor_id,))
        return cursor.rowcount > 0


def list_runs(monitor_id, limit=50):
    with store.connect() as db:
        output = []
        for row in db.execute("SELECT * FROM monitor_runs WHERE monitor_id=? ORDER BY started_at DESC LIMIT ?", (monitor_id, limit)):
            item = dict(row)
            item["result"] = store.decoded(row, "result")
            item["error"] = store.decoded(row, "error")
            output.append(item)
        return output


def list_alerts(status=None, limit=100):
    store.init_store()
    query = "SELECT a.*,m.name AS region_name,r.result AS run_result,r.finished_at AS processed_at FROM monitor_alerts a JOIN monitors m ON m.id=a.monitor_id JOIN monitor_runs r ON r.id=a.run_id"
    params = []
    if status:
        query += " WHERE a.verification_status=?"
        params.append(status)
    query += " ORDER BY a.created_at DESC LIMIT ?"
    params.append(limit)
    with store.connect() as db:
        output = []
        for row in db.execute(query, params):
            item = dict(row)
            item["measurement"] = store.decoded(row, "measurement", {})
            item["run_result"] = store.decoded(row, "run_result", {})
            result = item.pop("run_result")
            item["baseline_date"] = result.get("baseline_date")
            item["dataset"] = result.get("dataset")
            item["valid_pixel_coverage_percent"] = result.get("valid_pixel_coverage_percent")
            item["analysis_id"] = result.get("analysis_id")
            output.append(item)
        return output


def update_alert(alert_id, status):
    store.init_store()
    with store.connect() as db:
        cursor = db.execute("UPDATE monitor_alerts SET verification_status=? WHERE id=?", (status, alert_id))
        return dict(db.execute("SELECT * FROM monitor_alerts WHERE id=?", (alert_id,)).fetchone()) if cursor.rowcount else None


def list_notifications(unread_only=False):
    store.init_store()
    query = "SELECT n.*,a.category,a.summary,a.observation_date,a.monitor_id,m.name AS region_name FROM monitor_notifications n JOIN monitor_alerts a ON a.id=n.alert_id JOIN monitors m ON m.id=a.monitor_id"
    if unread_only:
        query += " WHERE n.read_at IS NULL"
    query += " ORDER BY n.created_at DESC LIMIT 100"
    with store.connect() as db:
        return [dict(r) for r in db.execute(query)]


def mark_notification_read(notification_id):
    store.init_store()
    with store.connect() as db:
        cursor = db.execute("UPDATE monitor_notifications SET read_at=? WHERE id=?", (store.now_iso(), notification_id))
        return cursor.rowcount > 0


def _create_run(monitor_id):
    run_id = str(uuid4())
    with store.connect() as db:
        db.execute("INSERT INTO monitor_runs(id,monitor_id,status,started_at) VALUES(?,?,'running',?)", (run_id, monitor_id, store.now_iso()))
    return run_id


def _finish_run(run_id, status, *, result=None, error=None, observation_date=None, analysis_id=None):
    with store.connect() as db:
        db.execute("UPDATE monitor_runs SET status=?,finished_at=?,result=?,error=?,observation_date=?,analysis_id=? WHERE id=?", (status, store.now_iso(), store.json_dump(result) if result is not None else None, store.json_dump(error) if error is not None else None, observation_date, analysis_id, run_id))


def _measurement(kind, measurements):
    if kind == "vegetation":
        return {"metric": "mean_ndvi_difference", "value": measurements.get("mean_ndvi_difference"), "unit": "index"}
    if kind == "water":
        value = measurements.get("net_mapped_water_area_change_m2")
        return {"metric": "net_mapped_water_area_change", "value": value, "unit": "square_metres", "value_hectares": value / 10000 if value is not None else None}
    value = measurements.get("net_mapped_built_up_proxy_change_ha")
    return {"metric": "net_mapped_built_up_proxy_change", "value": value, "unit": "hectares"}


def _crossed(kind, measurement, threshold):
    value = measurement.get("value")
    if value is None:
        return False
    if kind == "vegetation":
        return value <= -threshold
    if kind == "water":
        return abs(value) / 10000 >= threshold
    return abs(value) >= threshold


def _category(kind):
    return {"vegetation": "potential_vegetation_decline", "water": "significant_water_coverage_change", "urban": "mapped_built_up_area_change"}[kind]


def _create_alert(monitor, run_id, result, observation, measurement):
    config = monitor["config"]
    category = _category(config["analysis_type"])
    fingerprint_value = {"monitor_id": monitor["id"], "earlier": monitor["baseline_image_id"], "later": observation["image_id"], "category": category, "measurement": measurement}
    fingerprint = hashlib.sha256(store.json_dump(fingerprint_value).encode()).hexdigest()
    alert_id = str(uuid4())
    summary = f"Potential {config['analysis_type']} change exceeded the configured threshold. Satellite measurements require verification."
    with store.connect() as db:
        db.execute("INSERT OR IGNORE INTO monitor_alerts(id,monitor_id,run_id,category,observation_date,created_at,summary,measurement,layer_url,verification_status,fingerprint) VALUES(?,?,?,?,?,?,?,?,?,'pending',?)", (alert_id, monitor["id"], run_id, category, observation["date"], store.now_iso(), summary, store.json_dump(measurement), f"/api/analysis/{result['analysis_id']}/layers", fingerprint))
        row = db.execute("SELECT * FROM monitor_alerts WHERE fingerprint=?", (fingerprint,)).fetchone()
        was_created = row["id"] == alert_id
        if was_created and config.get("notifications", {}).get("in_app", True):
            db.execute("INSERT INTO monitor_notifications(id,alert_id,created_at) VALUES(?,?,?)", (str(uuid4()), alert_id, store.now_iso()))
    if was_created and config.get("notifications", {}).get("email"):
        send_email_if_configured(config["notifications"].get("email_to"), "TerraMind potential change alert", f"{summary}\nRegion: {monitor['name']}\nObservation date: {observation['date']}\nMeasurement: {measurement}")
    return dict(row), was_created


def run_monitor(monitor_id):
    """Run one configured monitor once. Safe for scheduler and manual-run endpoint."""
    with _run_lock:
        monitor = get_monitor(monitor_id)
        if not monitor:
            raise KeyError("Monitoring configuration not found")
        if monitor["status"] != "active":
            raise ValueError("Monitoring configuration is paused")
        run_id = _create_run(monitor_id)
        config = monitor["config"]
        try:
            end = date.today() + timedelta(days=1)
            max_days = get_ee_settings().max_search_days
            earliest_search = date.today() - timedelta(days=max_days)
            baseline_start = date.fromisoformat(monitor["baseline_date"]) if monitor["baseline_date"] else date.today() - timedelta(days=min(365, max_days))
            start = max(baseline_start, earliest_search)
            query = SatelliteSearchRequest(area_of_interest=config["area_of_interest"], start_date=start, end_date=end, dataset=config["dataset"], max_cloud_cover=config["max_cloud_cover"])
            earth_engine_client.initialize()
            geometry = ee.Geometry(config["area_of_interest"])
            try:
                area_sq_km = geometry.area(maxError=1000).divide(1_000_000).getInfo()
            except Exception as exc:
                earth_engine_client._raise_processing_error(exc)
            if area_sq_km > get_ee_settings().max_aoi_area_sq_km:
                raise ValueError("Monitoring AOI exceeds the configured Earth Engine area limit")
            observations = earth_engine_client.search(query, geometry)
            observations = sorted(observations, key=lambda item: (item.get("date") or "", item.get("image_id") or ""))
            def assess(candidate):
                if not candidate.get("image_id"):
                    return None
                cloud = candidate.get("cloud_cover")
                if cloud is not None and cloud > config["max_cloud_cover"]:
                    return None
                prepared = earth_engine_client.prepare_observation(candidate["image_id"], candidate["dataset"], geometry, target_scale_m=30, target_crs="EPSG:6933")
                coverage = prepared["metadata"].get("valid_pixel_coverage_percent", 0)
                if prepared.get("processing_status") == "no_valid_pixels" or coverage < config["minimum_valid_coverage_percent"]:
                    return None
                return {"scene_cloud_cover_percent": cloud, "valid_pixel_coverage_percent": coverage, "processing_status": prepared.get("processing_status")}

            def newest_usable(candidates):
                for candidate in reversed(candidates[-5:]):
                    quality = assess(candidate)
                    if quality:
                        return candidate, quality
                return None, None
            if monitor["baseline_image_id"] is None:
                baseline, baseline_quality = newest_usable(observations)
                if baseline is None:
                    _finish_run(run_id, "no_usable_observations", result={"message": "No new observation met the configured cloud and valid-pixel quality thresholds."})
                    with store.connect() as db:
                        db.execute("UPDATE monitors SET last_checked_at=? WHERE id=?", (store.now_iso(), monitor_id))
                    _schedule_next(monitor_id)
                    return {"run_id": run_id, "status": "no_usable_observations"}
                with store.connect() as db:
                    db.execute("UPDATE monitors SET baseline_date=?,baseline_image_id=?,baseline_dataset=?,last_checked_at=?,last_success_at=?,consecutive_failures=0 WHERE id=?", (baseline["date"], baseline["image_id"], baseline["dataset"], store.now_iso(), store.now_iso(), monitor_id))
                baseline_result = {"baseline_date": baseline["date"], "baseline_image_id": baseline["image_id"], "dataset": baseline["dataset"], "quality": baseline_quality}
                _finish_run(run_id, "baseline_initialized", result=baseline_result, observation_date=baseline["date"])
                _schedule_next(monitor_id)
                return {"run_id": run_id, "status": "baseline_initialized", "observation_date": baseline["date"]}

            unseen = [o for o in observations if o.get("image_id") != monitor["baseline_image_id"] and (o.get("date") or "") > (monitor["baseline_date"] or "")]
            observation, observation_quality = newest_usable(unseen)
            if observation is None:
                state = "no_usable_observations" if unseen else "no_new_observations"
                message = "New scenes were found, but none of the five most recent passed the AOI valid-pixel quality screen." if unseen else "No new matching satellite observation is available since the stored baseline."
                _finish_run(run_id, state, result={"message": message, "catalog_scene_count": len(unseen)})
                with store.connect() as db:
                    db.execute("UPDATE monitors SET last_checked_at=?,consecutive_failures=0 WHERE id=?", (store.now_iso(), monitor_id))
                _schedule_next(monitor_id)
                return {"run_id": run_id, "status": state}
            # Search already applies the scene-cloud limit. Keep metadata as an explicit quality check.
            cloud = observation.get("cloud_cover")
            if cloud is not None and cloud > config["max_cloud_cover"]:
                raise ValueError("Newest observation exceeds the configured scene cloud threshold")
            request = {"earlier_image_id": monitor["baseline_image_id"], "earlier_dataset": monitor["baseline_dataset"], "later_image_id": observation["image_id"], "later_dataset": observation["dataset"], "area_of_interest": config["area_of_interest"], "target_crs": "EPSG:6933", "target_scale_m": 30, "minimum_valid_coverage_percent": config["minimum_valid_coverage_percent"], "denominator_epsilon": 0.000001, "analysis_id": ""}
            if config["analysis_type"] == "vegetation": request["change_threshold"] = min(config["detection_threshold"], 2.0)
            elif config["analysis_type"] == "water": request["water_threshold"] = 0.0
            else: request["built_up_threshold"] = 0.1
            analysis_id = submit(config["analysis_type"], request)
            job = get_job(analysis_id)
            if job and job["status"] not in ("completed", "failed"):
                run_job(analysis_id)
                job = get_job(analysis_id)
            if not job or job["status"] != "completed":
                error = (job or {}).get("error") or {"code": "analysis_failed", "detail": "No completed analysis result was returned."}
                if error.get("code") == "earth_engine_quota_exceeded":
                    raise EarthEngineQuotaError(error.get("detail", "Earth Engine quota or rate limit reached"))
                if error.get("code") == "earth_engine_authentication_error":
                    raise EarthEngineAuthenticationError(error.get("detail", "Earth Engine authentication failed"))
                raise RuntimeError(error.get("detail", "Analysis failed"))
            result = {k: v for k, v in job["result"].items() if k != "_layer_images"}
            measurement = _measurement(config["analysis_type"], result["measurements"])
            alert = None
            if _crossed(config["analysis_type"], measurement, config["detection_threshold"]):
                alert, _ = _create_alert(monitor, run_id, result, observation, measurement)
            output = {"analysis_id": analysis_id, "baseline_image_id": monitor["baseline_image_id"], "observation_image_id": observation["image_id"], "baseline_date": monitor["baseline_date"], "observation_date": observation["date"], "dataset": observation["dataset"], "cloud_cover": cloud, "observation_valid_pixel_coverage_percent": observation_quality["valid_pixel_coverage_percent"], "valid_pixel_coverage_percent": result.get("valid_pixel_coverage_percent"), "measurement": measurement, "quality_warnings": result.get("quality_warnings", []), "analysis_result": result, "alert_id": alert["id"] if alert else None, "change_layer_url": f"/api/analysis/{analysis_id}/layers"}
            _finish_run(run_id, "completed", result=output, observation_date=observation["date"], analysis_id=analysis_id)
            with store.connect() as db:
                db.execute("UPDATE monitors SET baseline_date=?,baseline_image_id=?,baseline_dataset=?,last_checked_at=?,last_success_at=?,consecutive_failures=0 WHERE id=?", (observation["date"], observation["image_id"], observation["dataset"], store.now_iso(), store.now_iso(), monitor_id))
            _schedule_next(monitor_id)
            return {"run_id": run_id, "status": "completed", **output}
        except Exception as exc:
            logger.exception("Monitoring run failed for %s", monitor_id)
            _finish_run(run_id, "failed", error={"code": getattr(exc, "code", "monitoring_failed"), "detail": str(exc)})
            failures = monitor.get("consecutive_failures", 0) + 1
            with store.connect() as db:
                db.execute("UPDATE monitors SET last_checked_at=?,consecutive_failures=? WHERE id=?", (store.now_iso(), failures, monitor_id))
            _schedule_next(monitor_id, retry=failures <= 3)
            if isinstance(exc, EarthEngineAuthenticationError):
                # Credentials will not recover on a short retry loop.
                _schedule_next(monitor_id, retry=False)
            raise


def _schedule_next(monitor_id, *, status=None, retry=False):
    monitor = get_monitor(monitor_id)
    if not monitor:
        return
    delay = min(60, 5 * max(1, monitor.get("consecutive_failures", 0))) if retry else monitor["config"]["schedule_interval_minutes"]
    with store.connect() as db:
        db.execute("UPDATE monitors SET next_run_at=? WHERE id=?", ((datetime.now(timezone.utc) + timedelta(minutes=delay)).isoformat(), monitor_id))


def run_due_monitors(max_per_tick=2):
    store.init_store()
    now = datetime.now(timezone.utc).isoformat()
    with store.connect() as db:
        due = [r["id"] for r in db.execute("SELECT id FROM monitors WHERE status='active' AND next_run_at<=? ORDER BY next_run_at LIMIT ?", (now, max_per_tick))]
    outcomes = []
    for monitor_id in due:
        try:
            outcomes.append(run_monitor(monitor_id))
        except Exception as exc:
            outcomes.append({"monitor_id": monitor_id, "status": "failed", "detail": str(exc)})
            if isinstance(exc, EarthEngineQuotaError):
                break  # back off the entire tick when Earth Engine reports quota exhaustion
    return outcomes


def get_dashboard_summary():
    monitors = list_monitors()
    alerts = list_alerts(limit=100)
    return {"monitor_count": len(monitors), "active_monitor_count": sum(m["status"] == "active" for m in monitors), "pending_alert_count": sum(a["verification_status"] == "pending" for a in alerts), "unread_notification_count": len(list_notifications(unread_only=True)), "monitors": monitors, "recent_alerts": alerts[:20]}
