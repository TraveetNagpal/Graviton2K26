# TerraMind AI — Graviton 2K26

TerraMind AI is a satellite imagery analysis project for the 2026 CGC University Graviton hackathon.

## Backend

The backend is a FastAPI service. Install and run it from `backend/`:

```sh
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

API documentation is available at `http://localhost:8000/docs`.

### Earth Engine setup

1. Create/select a Google Cloud project, register it for Google Earth Engine, enable the Earth Engine API, and authorize the service identity for Earth Engine access.
2. From the repository root, copy `.env.example` to `backend/.env`. Configure `GEE_PROJECT`, `GEE_SERVICE_ACCOUNT` and either `GEE_PRIVATE_KEY_JSON` (the entire service-account JSON document) or `GEE_PRIVATE_KEY_FILE`. Workload identity can be used with `GEE_AUTH_MODE=ambient`.
3. Keep private keys in a secret manager or protected runtime mount. Never commit `.env` or expose credentials to frontend code.

### Satellite API

- `GET /api/earth-engine/status` checks configuration and Earth Engine API access without returning credentials.
- `POST /api/satellite/search` searches actual Earth Engine catalog observations for `sentinel-2`, `landsat`, `landsat-8` or `landsat-9`. Dates are ISO `YYYY-MM-DD`; `end_date` is exclusive. AOIs must be valid WGS84 GeoJSON Polygon/MultiPolygon geometries. Scene cloud percentage is reported as catalog metadata and does not represent cloudiness within the AOI.

Module 4 preprocessing lives in `backend/app/services/earth_engine/processing.py` and `local.py`. It applies Sentinel-2 SCL or Landsat Collection 2 QA_PIXEL masking, scales reflectance, standardizes common optical bands, computes AOI valid-pixel coverage, and aligns comparisons to a shared grid. The Earth Engine functions return lazy server-side images for the analysis engine; they do not transfer raster pixels through API JSON. Invalid reflectance remains masked. The NumPy local functions preserve invalid pixels as NaN and never interpret them as zero.

Sentinel-2 standardized six-band output defaults to 20 m to respect its native SWIR resolution; Landsat defaults to 30 m. Cross-sensor comparisons should use a common 30 m grid. Scene-level cloud metadata is not a substitute for AOI valid-pixel coverage, which is a clear-support proxy and not a guarantee of cloud-free pixels.

Run tests from `backend/` using `pytest`. Earth Engine credentials are not required for the local array QA tests. A real catalog integration check requires an authorized Earth Engine project and credentials.
