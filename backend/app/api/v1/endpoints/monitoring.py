from typing import Optional
from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from fastapi.responses import JSONResponse

from app.schemas.monitoring import AlertStatusUpdate, MonitoringConfigCreate, MonitoringConfigUpdate
from app.services.monitoring import service

router = APIRouter(prefix="/monitoring", tags=["Regional monitoring"])


@router.get("/dashboard")
def monitoring_dashboard():
    return service.get_dashboard_summary()


@router.post("", status_code=201)
def create_monitor(payload: MonitoringConfigCreate):
    return service.create_monitor(payload.model_dump(mode="json"))


@router.get("")
def list_monitors():
    return {"monitors": service.list_monitors()}


@router.get("/alerts")
def list_alerts(status: Optional[str] = Query(default=None, pattern="^(pending|reviewed|dismissed|investigate)$")):
    return {"alerts": service.list_alerts(status=status)}


@router.patch("/alerts/{alert_id}")
def update_alert(alert_id: str, payload: AlertStatusUpdate):
    result = service.update_alert(alert_id, payload.verification_status)
    if not result:
        raise HTTPException(status_code=404, detail="Alert not found")
    return result


@router.get("/notifications")
def notifications(unread_only: bool = False):
    return {"notifications": service.list_notifications(unread_only=unread_only)}


@router.patch("/notifications/{notification_id}/read")
def mark_read(notification_id: str):
    if not service.mark_notification_read(notification_id):
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"id": notification_id, "read": True}


@router.get("/{monitor_id}")
def get_monitor(monitor_id: str):
    result = service.get_monitor(monitor_id)
    if not result:
        raise HTTPException(status_code=404, detail="Monitoring configuration not found")
    return result


@router.put("/{monitor_id}")
def update_monitor(monitor_id: str, payload: MonitoringConfigUpdate):
    changes = payload.model_dump(mode="json", exclude_unset=True)
    changes = {key: value for key, value in changes.items() if value is not None}
    current = service.get_monitor(monitor_id)
    if not current:
        raise HTTPException(status_code=404, detail="Monitoring configuration not found")
    merged = dict(current["config"])
    merged.update(changes)
    try:
        validated = MonitoringConfigCreate.model_validate(merged).model_dump(mode="json")
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    result = service.update_monitor(monitor_id, validated)
    if not result:
        raise HTTPException(status_code=404, detail="Monitoring configuration not found")
    return result


@router.post("/{monitor_id}/pause")
def pause_monitor(monitor_id: str):
    result = service.set_monitor_status(monitor_id, "paused")
    if not result:
        raise HTTPException(status_code=404, detail="Monitoring configuration not found")
    return result


@router.post("/{monitor_id}/resume")
def resume_monitor(monitor_id: str):
    result = service.set_monitor_status(monitor_id, "active")
    if not result:
        raise HTTPException(status_code=404, detail="Monitoring configuration not found")
    return result


@router.delete("/{monitor_id}", status_code=204)
def delete_monitor(monitor_id: str):
    if not service.delete_monitor(monitor_id):
        raise HTTPException(status_code=404, detail="Monitoring configuration not found")


@router.get("/{monitor_id}/runs")
def monitor_runs(monitor_id: str):
    if not service.get_monitor(monitor_id):
        raise HTTPException(status_code=404, detail="Monitoring configuration not found")
    return {"runs": service.list_runs(monitor_id)}


@router.post("/{monitor_id}/run", status_code=202)
def run_now(monitor_id: str, background_tasks: BackgroundTasks):
    monitor = service.get_monitor(monitor_id)
    if not monitor:
        raise HTTPException(status_code=404, detail="Monitoring configuration not found")
    if monitor["status"] != "active":
        raise HTTPException(status_code=409, detail="Resume this monitoring configuration before running it")
    # Only this saved configuration can be queued; thresholds and AOI are validated on creation/update.
    background_tasks.add_task(service.run_monitor, monitor_id)
    return JSONResponse(status_code=202, content={"monitor_id": monitor_id, "status": "accepted", "runs_url": f"/api/monitoring/{monitor_id}/runs"})
