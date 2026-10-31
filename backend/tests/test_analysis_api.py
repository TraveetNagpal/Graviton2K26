from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app
from app.core.security import get_current_user

client = TestClient(app)
app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=1)
AOI = {"type": "Polygon", "coordinates": [[[77.5, 12.8], [77.7, 12.8], [77.7, 13], [77.5, 13], [77.5, 12.8]]]}


class FakeLayer:
    def getMapId(self, visualization):
        return {"mapid": "test-map-id", "tile_fetcher": SimpleNamespace(url_format="https://tiles.example/{z}/{x}/{y}")}


def test_vegetation_job_returns_numeric_result_and_layer_reference():
    def fake_analyze(kind, request):
        return {
            "analysis_id": request["analysis_id"],
            "analysis_type": kind,
            "status": "completed",
            "change_layer": {"name": "change", "layers_endpoint": f"/api/analysis/{request['analysis_id']}/layers"},
            "region": request["area_of_interest"],
            "observation_dates": {"earlier": "2024-01-01", "later": "2024-02-01"},
            "datasets": {},
            "analysis_method": "NDVI difference",
            "measurements": {"mean_ndvi_difference": -0.2, "mapped_decrease_area_ha": 12},
            "quality_warnings": [],
            "uncertainty": {"threshold_sensitivity_evaluated": False},
            "created_at": "2024-02-02T00:00:00Z",
            "_layer_images": {"change": FakeLayer()},
        }

    body = {
        "earlier_image_id": "COPERNICUS/S2_SR_HARMONIZED/first",
        "earlier_dataset": "sentinel-2",
        "later_image_id": "COPERNICUS/S2_SR_HARMONIZED/second",
        "later_dataset": "sentinel-2",
        "area_of_interest": AOI,
        "change_threshold": 0.12,
    }
    with patch("app.services.analysis.jobs.change_detection_engine.analyze", side_effect=fake_analyze):
        accepted = client.post("/api/analysis/vegetation", json=body)
    assert accepted.status_code == 202
    analysis_id = accepted.json()["analysis_id"]
    result = client.get(f"/api/analysis/{analysis_id}")
    assert result.status_code == 200
    assert result.json()["measurements"]["mean_ndvi_difference"] == -0.2
    assert result.json()["change_layer"]["name"] == "change"
    layers = client.get(f"/api/analysis/{analysis_id}/layers")
    assert layers.status_code == 200
    assert layers.json()["layers"][0]["map_id"] == "test-map-id"


def test_analysis_rejects_invalid_aoi():
    response = client.post("/api/analysis/water", json={
        "earlier_image_id": "LANDSAT/LC08/C02/T1_L2/first",
        "earlier_dataset": "landsat-8",
        "later_image_id": "LANDSAT/LC08/C02/T1_L2/second",
        "later_dataset": "landsat-8",
        "area_of_interest": {"type": "Point", "coordinates": [77, 12]},
    })
    assert response.status_code == 422


def test_missing_analysis_id_returns_404():
    response = client.get("/api/analysis/does-not-exist")
    assert response.status_code == 404
