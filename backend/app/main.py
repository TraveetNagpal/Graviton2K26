import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from collections import defaultdict, deque
from threading import Lock
from time import monotonic


from app.api.v1.endpoints.satellite import router as satellite_router
from app.api.v1.endpoints.analysis import router as analysis_router
from app.api.v1.endpoints.ai import router as ai_router

from app.api.v1.endpoints.reports import router as reports_router
from app.api.v1.endpoints.auth import router as auth_router
from app.api.v1.endpoints.regions import router as regions_router
from app.core.config import get_settings
from app.core.database import get_engine

from app.api.v1.endpoints.monitoring import router as monitoring_router
from app.services.monitoring.scheduler import start_scheduler, stop_scheduler

from app.services.earth_engine.errors import EarthEngineError
from sqlalchemy.exc import SQLAlchemyError
from app.services.monitoring_scheduler import start_scheduler, stop_scheduler

@asynccontextmanager
async def lifespan(_app):
    start_scheduler()
    try:
        yield
    finally:
        stop_scheduler()


app = FastAPI(title="TerraMind AI API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in os.getenv("FRONTEND_ORIGINS", "http://localhost:3000").split(",") if origin.strip()],
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)
app.include_router(satellite_router, prefix="/api")
app.include_router(analysis_router, prefix="/api")
app.include_router(ai_router, prefix="/api")

app.include_router(reports_router, prefix="/api")
app.include_router(auth_router, prefix="/api")
app.include_router(regions_router, prefix="/api")

settings = get_settings()
app.add_middleware(CORSMiddleware, allow_origins=[origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()], allow_credentials=True, allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"], allow_headers=["Authorization", "Content-Type"])
_rate_buckets: dict[tuple[str, str], deque[float]] = defaultdict(deque)
_rate_lock = Lock()


@app.on_event("startup")
def start_monitoring():
    try:
        start_scheduler()
    except Exception:
        # API can still serve requests when the optional scheduler is unavailable.
        import logging
        logging.getLogger(__name__).exception("Monitoring scheduler could not start")


@app.on_event("shutdown")
def stop_monitoring():
    stop_scheduler()


@app.middleware("http")
async def request_size_limit(request: Request, call_next):
    content_length = request.headers.get("content-length")
    try:
        if content_length and int(content_length) > settings.max_request_bytes:
            return JSONResponse(status_code=413, content={"detail": "Request body exceeds the configured size limit"})
    except ValueError:
        return JSONResponse(status_code=400, content={"detail": "Invalid Content-Length header"})
    if request.url.path.startswith(("/api/auth", "/api/satellite/search", "/api/analysis", "/api/ai/investigate")):
        key = (request.client.host if request.client else "unknown", request.url.path.split("/")[2])
        now = monotonic()
        with _rate_lock:
            bucket = _rate_buckets[key]
            while bucket and now - bucket[0] > 60:
                bucket.popleft()
            limit = 10 if key[1] == "auth" else 20 if key[1] == "satellite" else 60
            if len(bucket) >= limit:
                return JSONResponse(status_code=429, content={"detail": "Request rate limit exceeded; try again shortly"}, headers={"Retry-After": "60"})
            bucket.append(now)
    return await call_next(request)

app.include_router(monitoring_router, prefix="/api")



@app.exception_handler(EarthEngineError)
async def earth_engine_error_handler(request: Request, exc: EarthEngineError):
    return JSONResponse(status_code=exc.status_code, content={"error": exc.code, "detail": str(exc)})


@app.exception_handler(SQLAlchemyError)
async def database_error_handler(request: Request, exc: SQLAlchemyError):
    return JSONResponse(status_code=503, content={"error": "database_unavailable", "detail": "Database service is temporarily unavailable"})


@app.get("/health")
def health():
    database = "ok"
    try:
        with get_engine().connect() as connection:
            connection.exec_driver_sql("SELECT 1")
    except Exception:
        database = "unavailable"
    return JSONResponse(status_code=200 if database == "ok" else 503, content={"status": "ok" if database == "ok" else "degraded", "database": database})


@app.get("/ready")
def ready():
    """Deployment readiness check, including PostGIS extension availability."""
    try:
        with get_engine().connect() as connection:
            connection.exec_driver_sql("SELECT PostGIS_Version()")
        return {"status": "ready", "database": "postgresql+postgis"}
    except Exception:
        return JSONResponse(status_code=503, content={"status": "not_ready", "database": "unavailable"})
