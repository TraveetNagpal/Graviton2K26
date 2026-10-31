import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.monitoring import service
from app.services.monitoring import store

AOI = {"type": "Polygon", "coordinates": [[[77.5, 12.8], [77.7, 12.8], [77.7, 13], [77.5, 13], [77.5, 12.8]]]}


@pytest.fixture
def monitor_db(tmp_path, monkeypatch):
    monkeypatch.setenv("MONITOR_DB_PATH", str(tmp_path / "monitoring.sqlite3"))
    store.init_store()
    return tmp_path


def payload(**changes):
    value = {
        "name": "River reserve", "area_of_interest": AOI, "purpose": "Track seasonal vegetation",
        "dataset": "sentinel-2", "analysis_type": "vegetation", "detection_threshold": 0.12,
        "schedule_interval_minutes": 1440, "max_cloud_cover": 35,
        "minimum_valid_coverage_percent": 25, "notifications": {"in_app": True, "email": False},
    }
    value.update(changes)
    return value


def test_monitoring_create_validation_and_controls(monitor_db, monkeypatch):
    monkeypatch.setenv("MONITOR_SCHEDULER_ENABLED", "false")
    client = TestClient(app)
    created = client.post("/api/monitoring", json=payload())
    assert created.status_code == 201
    item = created.json()
    assert item["status"] == "active"
    assert item["config"]["name"] == "River reserve"
    assert client.post(f"/api/monitoring/{item['id']}/pause").json()["status"] == "paused"
    assert client.post(f"/api/monitoring/{item['id']}/resume").json()["status"] == "active"
    updated = client.put(f"/api/monitoring/{item['id']}", json={"detection_threshold": 0.2})
    assert updated.status_code == 200 and updated.json()["config"]["detection_threshold"] == 0.2
    assert client.put(f"/api/monitoring/{item['id']}", json={"area_of_interest": {"type": "Point", "coordinates": [0, 0]}}).status_code == 422
    with store.connect() as db:
        db.execute("UPDATE monitors SET baseline_date='2026-10-01',baseline_image_id='old-scene',baseline_dataset='sentinel-2' WHERE id=?", (item["id"],))
    changed_sensor = client.put(f"/api/monitoring/{item['id']}", json={"dataset": "landsat-8"})
    assert changed_sensor.status_code == 200 and changed_sensor.json()["baseline_image_id"] is None
    assert client.delete(f"/api/monitoring/{item['id']}").status_code == 204


def test_schedule_and_email_configuration_validation():
    from app.schemas.monitoring import MonitoringConfigCreate
    with pytest.raises(Exception):
        MonitoringConfigCreate.model_validate(payload(schedule_interval_minutes=1))
    with pytest.raises(Exception):
        MonitoringConfigCreate.model_validate(payload(notifications={"email": True, "email_to": "invalid"}))


def test_empty_monitoring_store_routes_return_empty_or_not_found(monitor_db, monkeypatch):
    monkeypatch.setenv("MONITOR_SCHEDULER_ENABLED", "false")
    client = TestClient(app)
    assert client.get("/api/monitoring/notifications").json() == {"notifications": []}
    assert client.get("/api/monitoring/missing-id").status_code == 404
    assert client.post("/api/monitoring/missing-id/pause").status_code == 404


def test_alert_threshold_units_and_duplicate_prevention(monitor_db):
    monitor = service.create_monitor(payload())
    run_id = "run-test"
    with store.connect() as db:
        db.execute("INSERT INTO monitor_runs(id,monitor_id,status,started_at) VALUES(?,?,?,?)", (run_id, monitor["id"], "completed", store.now_iso()))
    observation = {"image_id": "scene-2", "date": "2026-10-01", "dataset": "sentinel-2"}
    result = {"analysis_id": "analysis-test"}
    measurement = {"metric": "mean_ndvi_difference", "value": -0.2, "unit": "index"}
    assert service._crossed("vegetation", measurement, 0.12)
    first, created = service._create_alert(monitor, run_id, result, observation, measurement)
    second, created_again = service._create_alert(monitor, run_id, result, observation, measurement)
    assert created and not created_again and first["id"] == second["id"]
    assert len(service.list_alerts()) == 1
    assert len(service.list_notifications()) == 1
    assert service.update_alert(first["id"], "investigate")["verification_status"] == "investigate"
    assert not service._crossed("water", {"value": 500}, 0.1)
    assert service._crossed("water", {"value": 2000}, 0.1)


def test_scheduled_run_records_no_new_observations_without_fake_date(monitor_db, monkeypatch):
    monitor = service.create_monitor(payload())
    monkeypatch.setattr(service.earth_engine_client, "initialize", lambda: None)
    class FakeGeometry:
        def area(self, **kwargs): return self
        def divide(self, value): return self
        def getInfo(self): return 1
    monkeypatch.setattr(service.ee, "Geometry", lambda geojson: FakeGeometry())
    monkeypatch.setattr(service.earth_engine_client, "search", lambda request, geometry: [])
    result = service.run_monitor(monitor["id"])
    assert result["status"] == "no_usable_observations"
    runs = service.list_runs(monitor["id"])
    assert runs[0]["status"] == "no_usable_observations"
    assert runs[0]["result"]["message"].startswith("No new observation met")


def test_email_is_silent_without_complete_smtp_configuration(monkeypatch):
    from app.services.monitoring.notifications import send_email_if_configured
    for key in ("SMTP_HOST", "SMTP_FROM", "SMTP_USERNAME", "SMTP_PASSWORD"):
        monkeypatch.delenv(key, raising=False)
    assert send_email_if_configured("user@example.com", "alert", "body")["status"] == "not_configured"
