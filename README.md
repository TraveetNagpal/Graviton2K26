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

### Module 6: AI Earth Investigator

`POST /api/ai/investigate` accepts a question and a completed `analysis_id`. It returns backend-generated measurements and evidence (dates, dataset identifiers, method, valid-pixel coverage, warnings, uncertainty, and map-layer endpoint) alongside a cautious LLM interpretation. The model does not calculate or author measurements; the numeric finding is formatted directly from the completed Module 5 result. No cause is inferred. Without LLM configuration or when the provider is unavailable, the measured finding and evidence still return with an unavailable status.

To start work through the investigator, send `analysis: {analysis_type, parameters}` with one of `vegetation`, `water`, or `urban`; parameters must satisfy the same Module 5 Pydantic schemas and AOI validation. The endpoint returns `202` with a progress URL; after the job completes, submit the question again with the returned `analysis_id`. The investigator cannot launch arbitrary operations or bypass the analysis geographic limit. Questions outside the supported scope are declined. Set `LLM_API_KEY`, `LLM_MODEL`, and optionally `LLM_BASE_URL` / `LLM_TIMEOUT_SECONDS` in the backend environment; the key is never sent to the browser. The frontend panel is at `/explorer` and accepts the selected analysis ID and location/date context as props. Map layer links resolve through the existing Module 5 layers API; report links are left empty until a report is generated by the reports service.

The chat transcript currently lives in the browser session, while analysis job references remain process-local as described above. The LLM generates interpretation prose, so prompts restrict it to provided evidence and avoid numeric claims; the system always returns the separately rendered backend measurements as the authoritative finding.

### Module 7: historical analysis

The explorer at `/explorer` searches the Earth Engine catalog using `/api/satellite/search` (inclusive start date, exclusive end date), region, dataset, and scene-cloud threshold. It displays one **actual** observation with the lowest catalog scene-cloud value in each chosen day/week/month/quarter bucket; empty buckets are explicitly listed as missing. Scene cloud is only a catalog indicator and is not AOI cloud coverage. Selecting an observation calls `/api/satellite/preview`, which returns a server-generated Earth Engine true-colour map tile reference and QA metadata without transferring raster pixels.

To calculate a timeline, choose at least two selected actual observations and a baseline, then submit `POST /api/analysis/trend`. Each selected date is measured against that baseline using the existing Module 5 preprocessing and Earth Engine analysis functions. The request supports up to 30 dates; the response is a standard analysis job polled at `GET /api/analysis/{analysis_id}`. Completed points include measured NDVI, threshold-mapped water area, or NDBI built-up proxy area, valid coverage, warnings, paired analysis IDs, and layer URLs. Failed/insufficient observations have `status: unavailable` and `value: null`; they are not charted as zero. The interface exposes missing date buckets and does not interpolate missing measurement values. Sensor mixtures and observations from differing months receive comparability warnings.

Exact duplicate analysis requests reuse an accepted, running, or completed job within the current backend process. Cache and jobs are process-local and are lost on restart; use the durable task queue/database before production or multi-worker deployment. Trend computation is a sequence of baseline comparisons, so large selections can take time; narrow date range or use a coarser observation frequency. Configure `FRONTEND_ORIGINS` on the backend for browser access and `NEXT_PUBLIC_API_BASE_URL` in the frontend (the latter is a public URL only and must never contain credentials).

Run the web app from `frontend/` with `npm install` then `npm run dev`; copy `frontend/.env.example` to `.env.local` if the backend API is not at its localhost default.

Sentinel-2 standardized six-band output defaults to 20 m to respect its native SWIR resolution; Landsat defaults to 30 m. Cross-sensor comparisons should use a common 30 m grid. Scene-level cloud metadata is not a substitute for AOI valid-pixel coverage, which is a clear-support proxy and not a guarantee of cloud-free pixels.

Run tests from `backend/` using `pytest`. Earth Engine credentials are not required for the local array QA tests. A real catalog integration check requires an authorized Earth Engine project and credentials.
