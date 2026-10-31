from unittest.mock import patch
import pytest

from fastapi.testclient import TestClient

from app.main import app
client = TestClient(app)
AOI = {"type": "Polygon", "coordinates": [[[77.5, 12.8], [77.7, 12.8], [77.7, 13], [77.5, 13], [77.5, 12.8]]]}


def request_body():
    return {
        "analysis_type": "vegetation", "baseline_image_id": "S2/base", "area_of_interest": AOI,
        "observations": [
            {"date": "2024-01-01", "image_id": "S2/base", "dataset": "sentinel-2"},
            {"date": "2024-02-01", "image_id": "S2/missing", "dataset": "sentinel-2"},
            {"date": "2024-03-01", "image_id": "S2/later", "dataset": "sentinel-2"},
        ],
    }


def test_trend_keeps_failed_observations_missing_and_returns_real_values():
    def fake_analyze(kind, request):
        if request["later_image_id"] == "S2/missing":
            raise ValueError("insufficient shared valid pixels")
        return {
            "analysis_id": request["analysis_id"], "analysis_type": kind, "status": "completed",
            "region": AOI, "observation_dates": {"earlier": "2024-01-01", "later": "2024-03-01"},
            "datasets": {}, "analysis_method": "NDVI", "parameters": {}, "valid_pixel_coverage_percent": 82,
            "measurements": {"mean_ndvi_earlier": 0.6, "mean_ndvi_later": 0.3, "mean_ndvi_difference": -0.3},
            "quality_warnings": [], "uncertainty": {}, "change_layer": {}, "created_at": "2024-03-02",
            "_layer_images": {},
        }

    with patch("app.services.analysis.jobs.change_detection_engine.analyze", side_effect=fake_analyze):
        response = client.post("/api/analysis/trend", json=request_body())
    assert response.status_code == 202
    trend = client.get(response.json()["status_url"]).json()
    assert trend["status"] == "completed"
    points = trend["points"]
    assert [point["date"] for point in points] == ["2024-01-01", "2024-02-01", "2024-03-01"]
    assert points[0]["value"]["value"] == 0.6
    assert points[1]["status"] == "unavailable"
    assert points[1]["value"] is None
    assert "value" not in points[1] or points[1]["value"] is None
    assert points[2]["value"]["value"] == 0.3
    assert trend["missing_observation_count"] == 1


def test_identical_trend_request_reuses_completed_job():
    body = request_body()
    body["observations"] = body["observations"][:2]
    body["observations"][1]["image_id"] = "S2/later"
    body["observations"][1]["date"] = "2024-03-01"
    with patch("app.services.analysis.jobs.change_detection_engine.analyze", return_value={
        "analysis_id": "", "analysis_type": "vegetation", "status": "completed", "region": AOI,
        "observation_dates": {"earlier": "2024-01-01", "later": "2024-03-01"}, "datasets": {}, "analysis_method": "NDVI",
        "parameters": {}, "valid_pixel_coverage_percent": 90,
        "measurements": {"mean_ndvi_earlier": 0.6, "mean_ndvi_later": 0.3, "mean_ndvi_difference": -0.3},
        "quality_warnings": [], "uncertainty": {}, "change_layer": {}, "created_at": "2024-03-02", "_layer_images": {},
    }):
        first = client.post("/api/analysis/trend", json=body).json()
        second = client.post("/api/analysis/trend", json=body).json()
    assert first["analysis_id"] == second["analysis_id"]
    assert second["cached_or_in_progress"] is True


def test_trend_rejects_unsorted_dates_and_unselected_baseline():
    body = request_body()
    body["observations"].reverse()
    response = client.post("/api/analysis/trend", json=body)
    assert response.status_code == 422


def test_baseline_can_be_a_middle_date_and_earlier_change_sign_is_reversed():
    body = request_body()
    body["baseline_image_id"] = "S2/missing"
    def fake_analyze(kind, request):
        earlier = 0.4 if request["earlier_image_id"] == "S2/base" else 0.5
        later = 0.5 if request["later_image_id"] == "S2/missing" else 0.3
        actual_dates = {"S2/base": "2024-01-01", "S2/missing": "2024-02-01", "S2/later": "2024-03-01"}
        return {
            "analysis_id": request["analysis_id"], "analysis_type": kind, "status": "completed", "region": AOI,
            "observation_dates": {"earlier": actual_dates[request["earlier_image_id"]], "later": actual_dates[request["later_image_id"]]},
            "datasets": {}, "analysis_method": "NDVI", "parameters": {}, "valid_pixel_coverage_percent": 82,
            "measurements": {"mean_ndvi_earlier": earlier, "mean_ndvi_later": later, "mean_ndvi_difference": later - earlier},
            "quality_warnings": [], "uncertainty": {}, "change_layer": {}, "created_at": "2024-03-02", "_layer_images": {},
        }
    with patch("app.services.analysis.jobs.change_detection_engine.analyze", side_effect=fake_analyze):
        response = client.post("/api/analysis/trend", json=body)
    assert response.status_code == 202
    trend = client.get(response.json()["status_url"]).json()
    by_id = {point["image_id"]: point for point in trend["points"]}
    assert by_id["S2/missing"]["value"]["value"] == 0.5
    assert by_id["S2/base"]["change_from_baseline"]["value"] == pytest.approx(-0.1)
    assert by_id["S2/later"]["change_from_baseline"]["value"] == pytest.approx(-0.2)


def test_satellite_preview_returns_lightweight_tile_reference():
    class Area:
        def area(self, **kwargs): return self
        def divide(self, value): return self
        def getInfo(self): return 4.0
    class Image:
        def getMapId(self, visualization):
            return {"mapid": "preview-map", "tile_fetcher": type("Fetcher", (), {"url_format": "https://tiles.test/{z}/{x}/{y}"})()}
    with patch("app.api.v1.endpoints.satellite._validate_aoi"), patch("app.api.v1.endpoints.satellite.ee.Geometry", return_value=Area()), patch("app.api.v1.endpoints.satellite.earth_engine_client.initialize"), patch("app.api.v1.endpoints.satellite.earth_engine_client.prepare_observation", return_value={"image": Image(), "metadata": {"valid_pixel_coverage_percent": 95}}):
        response = client.post("/api/satellite/preview", json={"image_id": "S2/actual-image", "dataset": "sentinel-2", "area_of_interest": AOI})
    assert response.status_code == 200
    assert response.json()["layer"]["tile_url_template"].endswith("{z}/{x}/{y}")
    assert response.json()["metadata"]["valid_pixel_coverage_percent"] == 95
    body = request_body()
    body["baseline_image_id"] = "S2/not-selected"
    response = client.post("/api/analysis/trend", json=body)
    assert response.status_code == 422

