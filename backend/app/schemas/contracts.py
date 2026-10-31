"""Request/response contracts for satellite search and preparation."""
from datetime import date
from typing import Any, Literal
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
    cloud_cover: float | None
    cloud_cover_property: str | None
    quality: dict[str, Any]


class SatelliteSearchResponse(BaseModel):
    observations: list[Observation]
    processing: dict[str, Any]


class PrepareObservationRequest(BaseModel):
    image_id: str
    dataset: Dataset
    area_of_interest: dict[str, Any]
    target_scale_m: int | None = Field(default=None, gt=0)
    target_crs: str | None = None


class PrepareComparisonRequest(BaseModel):
    first_image_id: str
    first_dataset: Dataset
    second_image_id: str
    second_dataset: Dataset
    area_of_interest: dict[str, Any]
    target_crs: str
    target_scale_m: int = Field(default=30, gt=0)
    minimum_joint_coverage_percent: float = Field(default=20, ge=0, le=100)
