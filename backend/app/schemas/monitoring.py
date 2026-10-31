from __future__ import annotations

from typing import Any, Literal, Optional
from pydantic import BaseModel, Field, model_validator
from shapely.geometry import shape
from shapely.validation import explain_validity


class NotificationPreferences(BaseModel):
    in_app: bool = True
    email: bool = False
    email_to: Optional[str] = None

    @model_validator(mode="after")
    def valid_recipient(self):
        if self.email and (not self.email_to or "@" not in self.email_to or any(ch.isspace() for ch in self.email_to)):
            raise ValueError("email_to must be a valid recipient when email notifications are enabled")
        return self


class MonitoringConfigCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    area_of_interest: dict[str, Any]
    purpose: str = Field(min_length=1, max_length=500)
    dataset: Literal["sentinel-2", "landsat", "landsat-8", "landsat-9"] = "sentinel-2"
    analysis_type: Literal["vegetation", "water", "urban"]
    detection_threshold: float = Field(default=0.1, gt=0)
    schedule_interval_minutes: int = Field(default=1440, ge=15, le=43200)
    max_cloud_cover: float = Field(default=40, ge=0, le=100)
    minimum_valid_coverage_percent: float = Field(default=20, ge=1, le=100)
    notifications: NotificationPreferences = Field(default_factory=NotificationPreferences)

    @model_validator(mode="after")
    def validate_geometry(self):
        try:
            geometry = shape(self.area_of_interest)
            if geometry.geom_type not in ("Polygon", "MultiPolygon") or geometry.is_empty or not geometry.is_valid:
                why = explain_validity(geometry) if not geometry.is_empty else "geometry is empty"
                raise ValueError(f"AOI must be a valid non-empty Polygon or MultiPolygon: {why}")
            minx, miny, maxx, maxy = geometry.bounds
            if minx < -180 or maxx > 180 or miny < -90 or maxy > 90 or geometry.area <= 0 or geometry.area > 100:
                raise ValueError("AOI must be within WGS84 bounds and under the supported 100 square degree limit")
        except Exception as exc:
            raise ValueError(f"Invalid monitoring boundary: {exc}") from exc
        if self.analysis_type == "vegetation" and self.detection_threshold > 2:
            raise ValueError("Vegetation detection_threshold must be at most 2 NDVI units")
        return self


class MonitoringConfigUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    area_of_interest: Optional[dict[str, Any]] = None
    purpose: Optional[str] = Field(default=None, min_length=1, max_length=500)
    dataset: Optional[Literal["sentinel-2", "landsat", "landsat-8", "landsat-9"]] = None
    analysis_type: Optional[Literal["vegetation", "water", "urban"]] = None
    detection_threshold: Optional[float] = Field(default=None, gt=0)
    schedule_interval_minutes: Optional[int] = Field(default=None, ge=15, le=43200)
    max_cloud_cover: Optional[float] = Field(default=None, ge=0, le=100)
    minimum_valid_coverage_percent: Optional[float] = Field(default=None, ge=1, le=100)
    notifications: Optional[NotificationPreferences] = None


class AlertStatusUpdate(BaseModel):
    verification_status: Literal["reviewed", "dismissed", "investigate"]

