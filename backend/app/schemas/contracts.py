"""Request/response contracts for satellite search and preparation."""
from __future__ import annotations
from datetime import date
from typing import Any, Literal, Optional
from pydantic import BaseModel, Field, model_validator


Dataset = Literal["sentinel-2", "landsat", "landsat-8", "landsat-9"]


class SatelliteSearchRequest(BaseModel):
    area_of_interest: dict[str, Any] = Field(description="WGS84 GeoJSON Polygon or MultiPolygon")
    start_date: date
    end_date: date
    dataset: Dataset
    max_cloud_cover: float = Field(default=100, ge=0, le=100)

    @model_validator(mode="after")
    def ordered_dates(self):
        if self.end_date <= self.start_date:
            raise ValueError("end_date must be later than start_date; end_date is exclusive")
        return self


class Observation(BaseModel):
    date: str
    dataset: str
    dataset_id: str
    image_id: str
    image_reference: str
    cloud_cover: Optional[float]
    cloud_cover_property: Optional[str]
    quality: dict[str, Any]


class SatelliteSearchResponse(BaseModel):
    observations: list[Observation]
    processing: dict[str, Any]


class PrepareObservationRequest(BaseModel):
    image_id: str
    dataset: Dataset
    area_of_interest: dict[str, Any]
    target_scale_m: Optional[int] = Field(default=None, gt=0)
    target_crs: Optional[str] = None


class PrepareComparisonRequest(BaseModel):
    first_image_id: str
    first_dataset: Dataset
    second_image_id: str
    second_dataset: Dataset
    area_of_interest: dict[str, Any]
    target_crs: str
    target_scale_m: int = Field(default=30, gt=0)
    minimum_joint_coverage_percent: float = Field(default=20, ge=0, le=100)


class ChangeAnalysisRequest(BaseModel):
    earlier_image_id: str = Field(min_length=3)
    earlier_dataset: Dataset
    later_image_id: str = Field(min_length=3)
    later_dataset: Dataset
    area_of_interest: dict[str, Any] = Field(description="WGS84 GeoJSON Polygon or MultiPolygon")
    target_crs: str = "EPSG:6933"
    target_scale_m: int = Field(default=30, gt=0, le=1000)
    minimum_valid_coverage_percent: float = Field(default=20, ge=1, le=100)
    denominator_epsilon: float = Field(default=0.000001, gt=0, le=0.1)


class VegetationAnalysisRequest(ChangeAnalysisRequest):
    change_threshold: float = Field(default=0.1, gt=0, le=2)


class WaterAnalysisRequest(ChangeAnalysisRequest):
    water_threshold: float = Field(default=0.0, ge=-1, le=1)


class UrbanAnalysisRequest(ChangeAnalysisRequest):
    built_up_threshold: float = Field(default=0.1, ge=-1, le=1)


class TrendObservation(BaseModel):
    date: date
    image_id: str = Field(min_length=3)
    dataset: Dataset


class HistoricalTrendRequest(BaseModel):
    analysis_type: Literal["vegetation", "water", "urban"]
    observations: list[TrendObservation] = Field(min_length=2, max_length=30)
    baseline_image_id: str
    area_of_interest: dict[str, Any]
    target_crs: str = "EPSG:6933"
    target_scale_m: int = Field(default=30, gt=0, le=1000)
    minimum_valid_coverage_percent: float = Field(default=20, ge=1, le=100)
    denominator_epsilon: float = Field(default=0.000001, gt=0, le=0.1)
    change_threshold: float = Field(default=0.1, gt=0, le=2)
    water_threshold: float = Field(default=0.0, ge=-1, le=1)
    built_up_threshold: float = Field(default=0.1, ge=-1, le=1)

    @model_validator(mode="after")
    def valid_observations(self):
        ids = [item.image_id for item in self.observations]
        if len(set(ids)) != len(ids):
            raise ValueError("Observation image IDs must be unique")
        dates = [item.date for item in self.observations]
        if dates != sorted(dates) or len(set(dates)) != len(dates):
            raise ValueError("Observations must have unique dates and be supplied in chronological order")
        if self.baseline_image_id not in ids:
            raise ValueError("baseline_image_id must be one of the selected observations")
        return self
