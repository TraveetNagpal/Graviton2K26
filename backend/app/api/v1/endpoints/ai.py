"""Conversational orchestration over the existing measured analysis jobs."""
from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import JSONResponse
from shapely.geometry import shape
from shapely.validation import explain_validity

from app.schemas.ai import ANALYSIS_MODELS, InvestigationRequest
from app.services.ai.investigator import asks_for_cause, evidence_for, explain, is_supported_question, measured_finding
from app.services.analysis.jobs import get_job, run_job, submit

router = APIRouter(prefix="/ai", tags=["AI Earth Investigator"])


def _validate_region(geojson):
    try:
        geometry = shape(geojson)
        if geometry.geom_type not in ("Polygon", "MultiPolygon") or geometry.is_empty or not geometry.is_valid:
            reason = explain_validity(geometry) if not geometry.is_empty else "geometry is empty"
            raise ValueError(f"AOI must be a valid non-empty Polygon or MultiPolygon: {reason}")
        minx, miny, maxx, maxy = geometry.bounds
        if minx < -180 or maxx > 180 or miny < -90 or maxy > 90 or geometry.area <= 0 or geometry.area > 100:
            raise ValueError("AOI must be a non-degenerate WGS84 polygon within the supported geographic-area limit")
    except Exception as exc:
        raise HTTPException(status_code=422, detail={"error": "invalid_area", "detail": str(exc)}) from exc


@router.post("/investigate")
async def investigate(payload: InvestigationRequest, background_tasks: BackgroundTasks):
    """Explain a completed numerical analysis, or initiate a validated supported analysis."""
    question = payload.question.strip()
    if not is_supported_question(question):
        return {"status": "unsupported_question", "question": question, "answer": "I can answer questions about completed vegetation, water, or built-up proxy analyses. Please select a completed analysis or provide a supported analysis request.", "analysis_id": payload.analysis_id}

    if payload.analysis and not payload.analysis_id:
        if payload.region:
            _validate_region(payload.region)
        model = ANALYSIS_MODELS[payload.analysis.analysis_type]
        try:
            params = model.model_validate(payload.analysis.parameters)
            if payload.region and params.area_of_interest != payload.region:
                raise ValueError("analysis AOI must match the selected region")
            _validate_region(params.area_of_interest)
        except Exception as exc:
            raise HTTPException(status_code=422, detail={"error": "invalid_analysis_request", "detail": str(exc)}) from exc
        analysis_id = submit(payload.analysis.analysis_type, params.model_dump(mode="json"))
        background_tasks.add_task(run_job, analysis_id)
        return JSONResponse(status_code=202, content={
            "status": "analysis_started", "analysis_id": analysis_id,
            "progress_url": f"/api/analysis/{analysis_id}",
            "layers_url": f"/api/analysis/{analysis_id}/layers",
            "message": "The supported geospatial analysis is running. Submit this question again with analysis_id when it completes.",
        })

    if not payload.analysis_id:
        return {"status": "analysis_required", "question": question, "answer": "Select a completed analysis, or provide an analysis type and validated Module 5 parameters to start one."}
    job = get_job(payload.analysis_id)
    if not job:
        raise HTTPException(status_code=404, detail="Analysis not found. Analysis jobs are currently process-local and may not survive a restart.")
    if job["status"] in ("accepted", "running"):
        return JSONResponse(status_code=202, content={"status": job["status"], "analysis_id": payload.analysis_id, "progress_url": f"/api/analysis/{payload.analysis_id}", "message": "Waiting for numerical geospatial analysis to complete."})
    if job["status"] != "completed":
        return {"status": "analysis_failed", "analysis_id": payload.analysis_id, "error": job.get("error"), "answer": "No completed measurements are available for this analysis."}

    result = job["result"]
    evidence = evidence_for(job)
    finding = measured_finding(result)
    if asks_for_cause(question):
        interpretation, llm_status = "The supplied satellite measurements describe the observed index or mapped-area difference. They do not establish why the change occurred; additional contextual evidence is needed to assess possible causes.", "not_requested"
    elif not is_supported_question(question):
        interpretation, llm_status = "This question is outside the supported evidence-grounded analysis scope.", "not_requested"
    else:
        interpretation, llm_status = await explain(question, evidence)
    return {
        "status": "completed", "question": question,
        "finding": finding,
        "evidence": evidence,
        "interpretation": interpretation,
        "limitations": result.get("quality_warnings", []) + [result.get("uncertainty", {}).get("description", "")],
        "next_step": "Review the change layer and consider an additional observation or complementary analysis to verify the pattern.",
        "llm_status": llm_status,
    }
