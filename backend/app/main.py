import os

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.endpoints.satellite import router as satellite_router
from app.api.v1.endpoints.analysis import router as analysis_router
from app.api.v1.endpoints.ai import router as ai_router
from app.services.earth_engine.errors import EarthEngineError

app = FastAPI(title="TerraMind AI API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in os.getenv("FRONTEND_ORIGINS", "http://localhost:3000").split(",") if origin.strip()],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)
app.include_router(satellite_router, prefix="/api")
app.include_router(analysis_router, prefix="/api")
app.include_router(ai_router, prefix="/api")


@app.exception_handler(EarthEngineError)
async def earth_engine_error_handler(request: Request, exc: EarthEngineError):
    return JSONResponse(status_code=exc.status_code, content={"error": exc.code, "detail": str(exc)})


@app.get("/health")
def health():
    return {"status": "ok"}
