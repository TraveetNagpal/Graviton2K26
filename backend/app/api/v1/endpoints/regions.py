"""Private saved regions and monitoring configurations."""
from typing import Any, Literal
import json

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field
from shapely.geometry import MultiPolygon, Polygon, mapping, shape
from shapely.validation import explain_validity
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from geoalchemy2.shape import from_shape
from apscheduler.triggers.cron import CronTrigger

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.schema import MonitoringConfiguration, SavedRegion, User
from app.schemas.ai import ANALYSIS_MODELS
from app.services.analysis.jobs import run_job, submit

router = APIRouter(prefix="/regions", tags=["Saved regions and monitoring"])

class RegionPayload(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    geometry: dict[str, Any]

class MonitoringPayload(BaseModel):
    region_id: int
    name: str = Field(min_length=1, max_length=200)
    analysis_type: Literal["vegetation", "water", "urban"]
    schedule: str = Field(min_length=1, max_length=80, description="Five-field UTC cron schedule")
    parameters: dict[str, Any]

def validate_geometry(geojson: dict) -> Polygon | MultiPolygon:
    try:
        geometry = shape(geojson)
        if not isinstance(geometry, (Polygon, MultiPolygon)) or geometry.is_empty or not geometry.is_valid:
            raise ValueError(explain_validity(geometry) if not geometry.is_empty else "geometry is empty")
        minx, miny, maxx, maxy = geometry.bounds
        if minx < -180 or maxx > 180 or miny < -90 or maxy > 90 or geometry.area <= 0 or geometry.area > 100:
            raise ValueError("Geometry must be within WGS84 and below the supported area limit")
        return geometry
    except Exception as exc:
        raise HTTPException(status_code=422, detail={"error": "invalid_area", "detail": str(exc)}) from exc

@router.post("", status_code=201)
def save_region(payload: RegionPayload, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    geometry = validate_geometry(payload.geometry)
    multipolygon = MultiPolygon([geometry]) if isinstance(geometry, Polygon) else geometry
    row = SavedRegion(owner_id=user.id, name=payload.name, geometry=from_shape(multipolygon, srid=4326))
    db.add(row); db.commit(); db.refresh(row)
    return {"id": row.id, "name": row.name, "geometry": mapping(multipolygon)}

@router.get("")
def list_regions(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(SavedRegion).where(SavedRegion.owner_id == user.id).order_by(SavedRegion.created_at.desc())).all()
    return {"regions": [{"id": row.id, "name": row.name, "geometry": json.loads(db.scalar(select(func.ST_AsGeoJSON(SavedRegion.geometry)).where(SavedRegion.id == row.id)))} for row in rows]}

@router.post("/monitoring", status_code=201)
def create_monitoring(payload: MonitoringPayload, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    region = db.scalar(select(SavedRegion).where(SavedRegion.id == payload.region_id, SavedRegion.owner_id == user.id))
    if not region: raise HTTPException(status_code=404, detail="Saved region not found")
    try:
        CronTrigger.from_crontab(payload.schedule, timezone="UTC")
        model = ANALYSIS_MODELS[payload.analysis_type]
        parsed = model.model_validate(payload.parameters)
        selected = validate_geometry(parsed.area_of_interest)
        saved_geojson = db.scalar(select(func.ST_AsGeoJSON(SavedRegion.geometry)).where(SavedRegion.id == region.id))
        if selected.symmetric_difference(shape(json.loads(saved_geojson))).area > 1e-9:
            raise ValueError("Analysis AOI must match the saved region")
    except Exception as exc:
        raise HTTPException(status_code=422, detail={"error": "invalid_monitoring_parameters", "detail": str(exc)}) from exc
    row = MonitoringConfiguration(owner_id=user.id, region_id=region.id, name=payload.name, analysis_type=payload.analysis_type, schedule=payload.schedule, parameters=parsed.model_dump(mode="json"), active=True)
    db.add(row); db.commit(); db.refresh(row)
    from app.services.monitoring_scheduler import schedule_configuration
    schedule_configuration(row.id, row.schedule)
    return {"id": row.id, "name": row.name, "region_id": row.region_id, "analysis_type": row.analysis_type, "schedule": row.schedule, "active": row.active}

@router.get("/monitoring")
def list_monitoring(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(MonitoringConfiguration).where(MonitoringConfiguration.owner_id == user.id).order_by(MonitoringConfiguration.created_at.desc())).all()
    return {"configurations": [{"id": row.id, "name": row.name, "region_id": row.region_id, "analysis_type": row.analysis_type, "schedule": row.schedule, "active": row.active} for row in rows]}

@router.post("/monitoring/{configuration_id}/run", status_code=202)
def run_monitoring(configuration_id: int, background_tasks: BackgroundTasks, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.scalar(select(MonitoringConfiguration).where(MonitoringConfiguration.id == configuration_id, MonitoringConfiguration.owner_id == user.id, MonitoringConfiguration.active.is_(True)))
    if not row: raise HTTPException(status_code=404, detail="Active monitoring configuration not found")
    analysis_id = submit(row.analysis_type, row.parameters, owner_id=user.id)
    background_tasks.add_task(run_job, analysis_id)
    return {"analysis_id": analysis_id, "status": "accepted", "status_url": f"/api/analysis/{analysis_id}"}
