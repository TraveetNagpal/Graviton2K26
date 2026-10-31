from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.api.deps import get_workspace_user
from app.main import app
from app.services.reports.pdf_builder import build_analysis_pdf
from app.services.analysis.jobs import submit
from app.services.analysis.jobs import run_job
from app.api.v1.endpoints.reports import GenerateReportRequest, generate_report

client = TestClient(app)
app.dependency_overrides[get_workspace_user] = lambda: SimpleNamespace(id=1)


def test_report_pdf_contains_actual_provenance_and_handles_missing_values():
    result = {
        "analysis_id": "analysis-test", "analysis_type": "vegetation",
        "region": {"type": "Polygon", "coordinates": [[[77, 12], [77.1, 12], [77.1, 12.1], [77, 12.1], [77, 12]]]},
        "observation_dates": {"earlier": "2025-01-01", "later": "2026-01-01"},
        "datasets": {"earlier": {"dataset": "sentinel-2", "image_id": "S2/before"}, "later": {"dataset": "sentinel-2", "image_id": "S2/after"}},
        "analysis_method": "NDVI later minus earlier", "measurements": {"mean_ndvi_difference": None},
        "quality_warnings": ["Limited valid support"], "uncertainty": {"description": "Not a calibrated probability."},
    }
    pdf = build_analysis_pdf("Change report", result, "report-test")
    assert pdf.startswith(b"%PDF")
    assert len(pdf) > 500


def test_report_generation_rejects_unknown_analysis_id():
    response = client.post("/api/reports/generate", json={"analysis_id": "missing-analysis"})
    assert response.status_code == 404


def test_report_generation_cannot_read_another_workspace_analysis():
    analysis_id = submit("vegetation", {}, owner_id=2)
    response = client.post("/api/reports/generate", json={"analysis_id": analysis_id})
    assert response.status_code == 404


def test_completed_analysis_generates_traceable_pdf_and_measurement_csv(tmp_path, monkeypatch):
    analysis_id = submit("vegetation", {"area_of_interest": {"type": "Polygon", "coordinates": [[[77, 12], [77.1, 12], [77.1, 12.1], [77, 12.1], [77, 12]]] }}, owner_id=1)
    result = {
        "analysis_id": analysis_id, "analysis_type": "vegetation", "status": "completed",
        "region": {"type": "Polygon", "coordinates": [[[77, 12], [77.1, 12], [77.1, 12.1], [77, 12.1], [77, 12]]]},
        "observation_dates": {"earlier": "2025-01-01", "later": "2026-01-01"},
        "datasets": {"earlier": {"dataset": "sentinel-2", "image_id": "S2/before"}, "later": {"dataset": "sentinel-2", "image_id": "S2/after"}},
        "analysis_method": "NDVI later minus earlier", "measurements": {"mean_ndvi_difference": None, "mapped_increase_area_ha": 2.5},
        "quality_warnings": [], "uncertainty": {"description": "Threshold sensitivity not modeled."},
        "change_layer": {"layers_endpoint": f"/api/analysis/{analysis_id}/layers"}, "created_at": "2026-01-02T00:00:00Z", "_layer_images": {},
    }
    with patch("app.services.analysis.jobs.change_detection_engine.analyze", return_value=result):
        run_job(analysis_id)
    monkeypatch.setattr("app.api.v1.endpoints.reports.get_settings", lambda: SimpleNamespace(report_storage_dir=str(tmp_path)))
    class FakeDB:
        row = None
        def add(self, row): self.row = row
        def commit(self): pass
        def rollback(self): pass
    db = FakeDB()
    response = generate_report(GenerateReportRequest(analysis_id=analysis_id, title="Traceable NDVI", formats=["pdf", "csv"]), SimpleNamespace(id=1), db)
    report = response["report"]
    assert report["sourceAnalysisId"] == analysis_id
    assert report["observationDates"] == ["2025-01-01", "2026-01-01"]
    assert db.row.owner_id == 1
    assert (tmp_path / f"{report['id']}.pdf").read_bytes().startswith(b"%PDF")
    csv_text = (tmp_path / f"{report['id']}.csv").read_text(encoding="utf-8")
    assert "mapped_increase_area_ha,2.5,ha" in csv_text
    assert "mean_ndvi_difference,,index" not in csv_text


def test_processing_errors_are_not_returned_as_successful_analysis_results():
    payload = {
        "earlier_image_id": "COPERNICUS/S2_SR_HARMONIZED/old", "earlier_dataset": "sentinel-2",
        "later_image_id": "COPERNICUS/S2_SR_HARMONIZED/new", "later_dataset": "sentinel-2",
        "area_of_interest": {"type": "Polygon", "coordinates": [[[77, 12], [77.1, 12], [77.1, 12.1], [77, 12.1], [77, 12]]]},
    }
    with patch("app.services.analysis.jobs.change_detection_engine.analyze", side_effect=RuntimeError("provider unavailable")):
        accepted = client.post("/api/analysis/vegetation", json=payload)
    assert accepted.status_code == 202
    failed = client.get(accepted.json()["status_url"])
    assert failed.status_code == 200
    assert failed.json()["status"] == "failed"
    assert "result" not in failed.json()
