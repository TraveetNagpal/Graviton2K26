"""Contracts for evidence-grounded Earth Investigator requests."""
from datetime import date
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, model_validator

from app.schemas.contracts import VegetationAnalysisRequest, WaterAnalysisRequest, UrbanAnalysisRequest


class AnalysisLaunch(BaseModel):
    analysis_type: Literal["vegetation", "water", "urban"]
    parameters: dict[str, Any]


class InvestigationRequest(BaseModel):
    question: str = Field(min_length=3, max_length=2000)
    analysis_id: Optional[str] = None
    region: Optional[dict[str, Any]] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    analysis: Optional[AnalysisLaunch] = None

    @model_validator(mode="after")
    def valid_period(self):
        if self.start_date and self.end_date and self.end_date <= self.start_date:
            raise ValueError("end_date must be later than start_date")
        return self


ANALYSIS_MODELS = {
    "vegetation": VegetationAnalysisRequest,
    "water": WaterAnalysisRequest,
    "urban": UrbanAnalysisRequest,
}
