from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.main import app
from app.services.analysis.jobs import submit, run_job
from app.core.security import get_current_user
from types import SimpleNamespace

client = TestClient(app)
app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=1)
AOI = {"type": "Polygon", "coordinates": [[[77.5, 12.8], [77.7, 12.8], [77.7, 13], [77.5, 13], [77.5, 12.8]]]}


def completed_vegetation_job():
    analysis_id = submit("vegetation", {}, owner_id=1)
    with patch("app.services.analysis.jobs.change_detection_engine.analyze", return_value={
        "analysis_id": analysis_id, "analysis_type": "vegetation", "status": "completed",
        "region": AOI, "observation_dates": {"earlier": "2024-01-01", "later": "2024-02-01"},
        "datasets": {"earlier": {"dataset": "sentinel-2"}, "later": {"dataset": "sentinel-2"}},
        "analysis_method": "NDVI difference", "parameters": {},
        "valid_pixel_coverage_percent": 76.5,
        "measurements": {"mean_ndvi_earlier": 0.4, "mean_ndvi_later": 0.2, "mean_ndvi_difference": -0.2, "mapped_decrease_area_ha": 12.5, "mapped_increase_area_ha": 1.2},
        "quality_warnings": ["Cloud mask reduced coverage."],
        "uncertainty": {"description": "Not a calibrated probability."},
        "change_layer": {"name": "change", "layers_endpoint": f"/api/analysis/{analysis_id}/layers"},
        "_layer_images": {},
    }):
        run_job(analysis_id)
    return analysis_id


def test_investigation_uses_measured_backend_evidence_and_exposes_layer_reference():
    analysis_id = completed_vegetation_job()
    with patch("app.api.v1.endpoints.ai.explain", new=AsyncMock(return_value=("The index declined; its cause is not established.", "available"))) as llm:
        response = client.post("/api/ai/investigate", json={"question": "How has vegetation changed?", "analysis_id": analysis_id})
    assert response.status_code == 200
    body = response.json()
    assert "0.4000 to 0.2000" in body["finding"]
    assert "12.5000 ha" in body["finding"]
    assert body["evidence"]["observation_dates"]["earlier"] == "2024-01-01"
    assert body["evidence"]["layers_url"].endswith("/layers")
    assert body["llm_status"] == "available"
    llm.assert_awaited_once()


def test_unsupported_question_does_not_call_llm_or_invent_result():
    with patch("app.api.v1.endpoints.ai.explain", new=AsyncMock()) as llm:
        response = client.post("/api/ai/investigate", json={"question": "What species of bird nested here?"})
    assert response.status_code == 200
    assert response.json()["status"] == "unsupported_question"
    llm.assert_not_awaited()


def test_cause_question_is_explicitly_unestablished():
    analysis_id = completed_vegetation_job()
    with patch("app.api.v1.endpoints.ai.explain", new=AsyncMock()) as llm:
        response = client.post("/api/ai/investigate", json={"question": "What caused the vegetation change?", "analysis_id": analysis_id})
    assert response.status_code == 200
    assert "not proof of vegetation loss" in response.json()["finding"]
    assert "do not establish why" in response.json()["interpretation"]
    llm.assert_not_awaited()


def test_analysis_launch_validates_area_before_creating_job():
    response = client.post("/api/ai/investigate", json={
        "question": "Summarize vegetation change", "region": {"type": "Point", "coordinates": [77, 12]},
        "analysis": {"analysis_type": "vegetation", "parameters": {
            "earlier_image_id": "S2/one", "earlier_dataset": "sentinel-2", "later_image_id": "S2/two", "later_dataset": "sentinel-2", "area_of_interest": {"type": "Point", "coordinates": [77, 12]},
        }},
    })
    assert response.status_code == 422
