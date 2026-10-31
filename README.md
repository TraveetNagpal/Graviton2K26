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

### Module 5: change detection

All satellite measurements are calculated numerically with Earth Engine; the language model is not used to estimate values. The `POST /api/analysis/vegetation`, `/api/analysis/water`, and `/api/analysis/urban` endpoints accept earlier/later Earth Engine image IDs and dataset keys, a WGS84 Polygon/MultiPolygon AOI, and optional analysis thresholds / target grid. They return `202 Accepted` and an `analysis_id`. Poll `GET /api/analysis/{analysis_id}` for progress or the completed measurements. `GET /api/analysis/{analysis_id}/layers` returns map tile references for the change and supporting index layers without returning raster pixels. Tile references are scoped Earth Engine map tokens; private service credentials remain server-side.

Vegetation uses NDVI `(NIR-Red)/(NIR+Red)` and reports `later - earlier`. The configurable `change_threshold` (default 0.1) reports mapped decrease and increase area above/below the signed threshold. A negative difference is an index decrease, not proof of vegetation loss. Water uses McFeeters NDWI `(Green-NIR)/(Green+NIR)`; pixels with NDWI greater than `water_threshold` (default 0.0) are classified as mapped open water. Area and net/gain/loss changes are calculated from Earth Engine `pixelArea()` under a common valid mask. This threshold can misclassify built surfaces, shadows, wet soil, and turbid or shallow water. Urban analysis uses NDBI `(SWIR1-NIR)/(SWIR1+NIR)` above `built_up_threshold` (default 0.1) as a coarse built-up land-surface proxy; it is not a validated land-cover model and does not detect individual buildings. Bare/bright soil and dry surfaces can be false positives.

All indices mask pixels with invalid denominators and use Module 4's shared QA/missing-pixel masks. The default comparison grid is 30 m in EPSG:6933; callers can choose another projected CRS and scale. Requests fail if joint valid-pixel coverage falls below `minimum_valid_coverage_percent` (default 20%). Responses include input asset IDs, dates read from the Earth Engine assets, dataset IDs, method/thresholds, numerical summaries, affected-area estimates, valid-pixel coverage, warnings, and uncertainty notes. The code reports deterministic thresholded values, not calibrated confidence probabilities; threshold sensitivity is not currently modeled.

Analysis work currently uses FastAPI background tasks and a process-local job registry. Jobs and tile layer objects disappear on process restart and are not shared across multiple workers. Use a durable task queue and database before horizontal scaling or production use. `backend/app/services/analysis/indices.py` contains NumPy implementations of the formulas, threshold categorization, and area summation; `backend/tests/test_analysis_indices.py` and `test_analysis_api.py` cover known values, masks, thresholds, area, endpoints, and output layers.

Sentinel-2 standardized six-band output defaults to 20 m to respect its native SWIR resolution; Landsat defaults to 30 m. Cross-sensor comparisons should use a common 30 m grid. Scene-level cloud metadata is not a substitute for AOI valid-pixel coverage, which is a clear-support proxy and not a guarantee of cloud-free pixels.

Run tests from `backend/` using `pytest`. Earth Engine credentials are not required for the local array QA tests. A real catalog integration check requires an authorized Earth Engine project and credentials.
