"""Evidence selection and optional, non-numeric LLM interpretation."""
import json
import logging

import httpx

from app.core.config import get_ai_settings

logger = logging.getLogger(__name__)


def _fmt(value):
    if value is None:
        return "not available in the analysis result"
    return f"{value:,.4f}" if isinstance(value, (int, float)) else str(value)


def measured_finding(result: dict) -> str:
    m = result.get("measurements", {})
    kind = result.get("analysis_type")
    if kind == "vegetation":
        return ("Mean NDVI changed from {a} to {b} (mean difference {d}). The analysis mapped {area} ha above the configured decrease threshold and {gain} ha above the increase threshold. A negative NDVI difference is an index decrease, not proof of vegetation loss.".format(
            a=_fmt(m.get("mean_ndvi_earlier")), b=_fmt(m.get("mean_ndvi_later")), d=_fmt(m.get("mean_ndvi_difference")), area=_fmt(m.get("mapped_decrease_area_ha")), gain=_fmt(m.get("mapped_increase_area_ha"))))
    if kind == "water":
        return ("Threshold-mapped water coverage changed from {a} ha to {b} ha (net change {d} m²). These are index-threshold estimates, not a definitive water inventory.".format(
            a=_fmt(m.get("mapped_water_area_earlier_ha")), b=_fmt(m.get("mapped_water_area_later_ha")), d=_fmt(m.get("net_mapped_water_area_change_m2"))))
    if kind == "urban":
        return ("Mapped built-up proxy area changed from {a} ha to {b} ha (net change {d} ha). NDBI thresholding is a coarse land-surface proxy and does not detect individual buildings.".format(
            a=_fmt(m.get("mapped_built_up_proxy_area_earlier_ha")), b=_fmt(m.get("mapped_built_up_proxy_area_later_ha")), d=_fmt(m.get("net_mapped_built_up_proxy_change_ha"))))
    return "The completed analysis does not identify a supported measurement type."


def evidence_for(job: dict) -> dict:
    result = job["result"]
    return {
        "analysis_id": job["analysis_id"],
        "analysis_type": result["analysis_type"],
        "region": result.get("region"),
        "observation_dates": result.get("observation_dates"),
        "datasets": result.get("datasets"),
        "analysis_method": result.get("analysis_method"),
        "parameters": result.get("parameters"),
        "measurements": result.get("measurements"),
        "valid_pixel_coverage_percent": result.get("valid_pixel_coverage_percent"),
        "quality_warnings": result.get("quality_warnings", []),
        "uncertainty": result.get("uncertainty"),
        "change_layer": result.get("change_layer"),
        "layers_url": f"/api/analysis/{job['analysis_id']}/layers",
        "report_url": None,
    }


async def explain(question: str, evidence: dict) -> tuple[str, str]:
    settings = get_ai_settings()
    if not settings.api_key or not settings.model:
        return ("Automated interpretation is unavailable because no LLM is configured. Use the measured finding, evidence, and limitations below.", "unavailable")
    body = {
        "model": settings.model,
        "temperature": 0,
        "messages": [
            {"role": "system", "content": "You are TerraMind's cautious Earth observation investigator. Use only the supplied completed analysis evidence. Do not add or alter measurements, dates, datasets, observations, confidence percentages, events, or causes. Never infer a cause. If evidence is insufficient, say so. Return only a short cautious interpretation and a useful next-step suggestion; do not restate numbers."},
            {"role": "user", "content": json.dumps({"question": question, "evidence": evidence}, separators=(",", ":"))},
        ],
    }
    try:
        async with httpx.AsyncClient(timeout=settings.timeout_seconds) as client:
            response = await client.post(f"{settings.base_url.rstrip('/')}/chat/completions", headers={"Authorization": f"Bearer {settings.api_key}"}, json=body)
            response.raise_for_status()
            content = response.json()["choices"][0]["message"]["content"]
            if not isinstance(content, str) or not content.strip():
                raise ValueError("LLM returned empty content")
            return content.strip(), "available"
    except Exception:
        logger.exception("Earth Investigator LLM request failed")
        return ("Automated interpretation is temporarily unavailable. The measured finding and source evidence are still available below.", "unavailable")


def is_supported_question(question: str) -> bool:
    q = question.lower()
    return any(term in q for term in ("vegetation", "ndvi", "water", "ndwi", "urban", "built-up", "built up", "builtup", "change", "changed", "compare", "summar", "observation", "verify", "cause", "why", "area", "coverage", "layer"))


def asks_for_cause(question: str) -> bool:
    q = question.lower()
    return any(term in q for term in ("cause", "caused", "why did", "why has", "reason for", "because of", "what led to"))
