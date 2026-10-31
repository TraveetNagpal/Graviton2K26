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

Analysis work uses FastAPI background tasks. When `PERSIST_ANALYSIS_JOBS=true`, job status and numerical results are stored in PostgreSQL; live Earth Engine tile objects remain process-local and can be unavailable after a worker restart. Use one backend worker with the included scheduler. `backend/app/services/analysis/indices.py` contains NumPy implementations of the formulas, threshold categorization, and area summation; the backend tests cover known values, masks, thresholds, area, endpoints, and output layers.

### Module 6: AI Earth Investigator

`POST /api/ai/investigate` accepts a question and a completed `analysis_id`. It returns backend-generated measurements and evidence (dates, dataset identifiers, method, valid-pixel coverage, warnings, uncertainty, and map-layer endpoint) alongside a cautious LLM interpretation. The model does not calculate or author measurements; the numeric finding is formatted directly from the completed Module 5 result. No cause is inferred. Without LLM configuration or when the provider is unavailable, the measured finding and evidence still return with an unavailable status.

To start work through the investigator, send `analysis: {analysis_type, parameters}` with one of `vegetation`, `water`, or `urban`; parameters must satisfy the same Module 5 Pydantic schemas and AOI validation. The endpoint returns `202` with a progress URL; after the job completes, submit the question again with the returned `analysis_id`. The investigator cannot launch arbitrary operations or bypass the analysis geographic limit. Questions outside the supported scope are declined. Set `LLM_API_KEY`, `LLM_MODEL`, and optionally `LLM_BASE_URL` / `LLM_TIMEOUT_SECONDS` in the backend environment; the key is never sent to the browser. The frontend panel is at `/explorer` and accepts the selected analysis ID and location/date context as props. Map layer links resolve through the existing Module 5 layers API; report links are left empty until a report is generated by the reports service.

The chat transcript currently lives in the browser session. The LLM generates interpretation prose, so prompts restrict it to provided evidence and avoid numeric claims; the system always returns the separately rendered backend measurements as the authoritative finding.

### Module 7: historical analysis

The root Vite app's Earth Explorer includes a Historical timeline panel. It uses the drawn polygon and searches the Earth Engine catalog using `/api/satellite/search` (inclusive start date, exclusive end date), dates, dataset, frequency, and scene-cloud threshold. It displays one **actual** observation with the lowest catalog scene-cloud value in each chosen day/week/month/quarter bucket; empty buckets are explicitly listed as missing. Scene cloud is only a catalog indicator and is not AOI cloud coverage. Selecting an observation calls `/api/satellite/preview`, which returns a server-generated Earth Engine true-colour map tile reference and QA metadata; the selected date's tile layer is displayed on the existing 2D/3D map.

To calculate a timeline, choose at least two selected actual observations and a baseline, then submit `POST /api/analysis/trend`. Each selected date is measured against that baseline using the existing Module 5 preprocessing and Earth Engine analysis functions. The request supports up to 30 dates; the response is a standard analysis job polled at `GET /api/analysis/{analysis_id}`. Completed points include measured NDVI, threshold-mapped water area, or NDBI built-up proxy area, valid coverage, warnings, paired analysis IDs, and layer URLs. Failed/insufficient observations have `status: unavailable` and `value: null`; they are not charted as zero. The interface exposes missing date buckets and does not interpolate missing measurement values. Sensor mixtures and observations from differing months receive comparability warnings.

Exact duplicate analysis requests reuse an accepted, running, or completed job within the current backend process. Cache and jobs are process-local and are lost on restart; use the durable task queue/database before production or multi-worker deployment. Trend computation is a sequence of baseline comparisons, so large selections can take time; narrow date range or use a coarser observation frequency. Configure `FRONTEND_ORIGINS` on the backend for browser access and `VITE_API_BASE_URL` in the Vite app (the latter is a public URL only and must never contain credentials).

Run the main web app from the repository root with `npm install` then `npm run dev`; Vite proxies same-origin `/api` requests to the backend on port 8000.

### Module 8: regional monitoring and alerts

The Dashboard at `/dashboard` creates, edits, pauses, resumes, and deletes saved monitoring regions. Boundaries are WGS84 GeoJSON polygons and follow the analysis API geographic-area limit. Configurations select Sentinel-2 or Landsat, a vegetation/water/urban index analysis, a detection threshold, minimum valid-pixel coverage, maximum catalog scene cloud, interval (15 minutes to 30 days), and in-app or optional email notification preferences. Use a polygon selected in Earth Explorer or paste GeoJSON.

The backend scheduler starts with FastAPI and polls due configurations. Set `MONITOR_SCHEDULER_ENABLED=false` to disable it for one-off API deployments. `MONITOR_SCHEDULER_POLL_SECONDS` controls polling (minimum 15 seconds), and `MONITOR_SCHEDULER_BATCH_SIZE` bounds work per tick to respect Earth Engine quotas. The scheduler is a single-process standard-library worker; run only one scheduler-enabled API worker per SQLite database. Use a shared task queue and transactional database before horizontal scaling. Set `MONITOR_DB_PATH` to a persistent writable file path in deployment; SQLite defaults to `terramind_monitoring.sqlite3` in the backend working directory and is ignored by Git.

API routes: `POST/GET /api/monitoring`, `GET/PUT/DELETE /api/monitoring/{monitor_id}`, `POST /api/monitoring/{monitor_id}/pause`, `/resume`, `/run`, `GET /api/monitoring/{monitor_id}/runs`, `GET /api/monitoring/alerts`, `PATCH /api/monitoring/alerts/{alert_id}`, `GET /api/monitoring/notifications`, `PATCH /api/monitoring/notifications/{notification_id}/read`, and `GET /api/monitoring/dashboard`. Interactive schemas and request examples are available in FastAPI `/docs`.

The first successful run uses the newest actual catalog scene that passes configured scene-cloud and AOI valid-pixel checks as its baseline; it does not raise a change alert. Later runs search for a newer real observation. If none is available, the run is logged as `no_new_observations` and the baseline is unchanged. Analysis calls the same Module 5 numerical Earth Engine engine, using its QA masks, shared valid pixels, index calculations, area calculations, and coverage threshold. A failed paired analysis does not advance the baseline. Runs and compact full analysis results, observations, and errors persist in SQLite. Exact alert fingerprints are unique per baseline/observation/measurement, preventing repeat notifications for an unchanged result. Transient failures retry with increasing delays; Earth Engine quota exhaustion backs off the scheduler tick, and credentials failures are logged without a short retry loop.

Vegetation alerts trigger when mean NDVI difference is at or below the negative configured threshold (index units). Water alerts trigger when absolute net mapped NDWI water-area change exceeds the threshold in hectares. Built-up alerts use absolute net mapped NDBI proxy change in hectares. These are deterministic thresholded measurements, not confidence probabilities. Alerts remain pending until marked reviewed, dismissed, or requiring investigation. They are potential changes supported by satellite analysis, not confirmed environmental events or evidence of cause. Scene cloud metadata is not AOI cloud cover; paired valid-pixel coverage and warnings accompany measurements. The first run can wait until its scheduled interval unless an operator requests `POST /api/monitoring/{monitor_id}/run`.

In-app notifications are enabled by default. Email is optional and is sent only when the configuration includes an email recipient and all backend-only `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, and `SMTP_FROM` values are configured. Keep SMTP secrets out of frontend variables and version control. The dashboard defaults email off. Failed email delivery is logged without invalidating a completed analysis or alert.

Monitoring run and alert records survive restart. Existing Module 5 tile layer objects and analysis jobs remain process-local, so layer URLs in old alerts may no longer resolve after a backend restart; measurements and the full compact analysis result remain persisted for audit. Multi-worker scheduling, distributed locking, durable map exports, and delivery retry queues require a shared production queue/database.

Sentinel-2 standardized six-band output defaults to 20 m to respect its native SWIR resolution; Landsat defaults to 30 m. Cross-sensor comparisons should use a common 30 m grid. Scene-level cloud metadata is not a substitute for AOI valid-pixel coverage, which is a clear-support proxy and not a guarantee of cloud-free pixels.

Run tests from `backend/` using `pytest`. Earth Engine credentials are not required for the local array QA tests. A real catalog integration check requires an authorized Earth Engine project and credentials.
## Reports (Module 9)

The `/reports` page lists the signed-in user's report history and lets them submit a source analysis ID for report generation. Configure `VITE_API_BASE_URL` to the API root (for example `http://localhost:8000/api`). The API implements `POST /reports/generate`, `GET /reports`, `GET /reports/{report_id}`, and owner-authorized artifact downloads. See [the API and integration contract](docs/map-integration.md#module-9--reports-and-exports) for response shape, authorization, provenance, and artifact requirements.

The report service now builds PDF and CSV artifacts from completed backend analysis records. The frontend does not fabricate analysis values; GeoJSON is offered only when compatible vector output exists (the current change layers are rasters, so GeoJSON is disabled).

## Module 10 — local deployment and security

The integrated application uses the existing Vite/React explorer and FastAPI backend. PostgreSQL with PostGIS stores users, saved regions, satellite observation metadata, analysis job/result metadata, monitoring configurations, alerts, and report metadata. Raster pixels remain in Earth Engine or external raster storage; reports are written to the mounted report artifact volume.

### Run the integrated stack

1. Copy `.env.example` to `.env` and set strong random `POSTGRES_PASSWORD` and `AUTH_SECRET` values. For example, use `openssl rand -hex 32` for each secret. Never commit `.env`, Earth Engine keys, or generated reports.
2. Put the authorized Earth Engine service account JSON at `./secrets/earth-engine-service-account.json` (or set `GEE_KEY_HOST_PATH` to its protected host path). The backend mounts it read-only. Set `GEE_PROJECT` and `GEE_SERVICE_ACCOUNT` to match.
3. Run `docker compose up --build`. Compose starts PostGIS, runs Alembic migrations before FastAPI, and serves the frontend at `http://localhost:8080`. The backend API is at `http://localhost:8000`; health and readiness are `/health` and `/ready`.
4. Open Reports and create an account (password minimum 12 characters). Then open the Explorer, draw a polygon, search actual catalog observations, choose two dates, and run vegetation analysis. Results and report downloads are scoped to the signed-in account.

For frontend-only development, run `npm install` and `npm run dev`; Vite proxies `/api` to a backend on port 8000. For backend development, install `backend/requirements.txt`, set the same server environment variables, start PostgreSQL/PostGIS, then run `alembic upgrade head` and `uvicorn app.main:app --reload` from `backend/`.

### Configuration and API security

`AUTH_SECRET` is mandatory for authentication; Compose refuses to start without it. The API issues expiring bearer tokens from `/api/auth/register` and `/api/auth/token`. Protected analysis, catalog, investigator, reports, saved-region, and monitoring routes require `Authorization: Bearer …`. Private queries filter by owner. `CORS_ORIGINS`, `MAX_REQUEST_BYTES`, and the per-IP request limits are server-side settings. Earth Engine and LLM credentials are read only by FastAPI. Do not use a frontend `VITE_` or `NEXT_PUBLIC_` prefix for private credentials.

Database changes are under `backend/migrations/`; apply with `alembic upgrade head` from `backend/`. Use `alembic revision --autogenerate -m "description"` for future schema changes and review generated migrations before applying. PostgreSQL/PostGIS is required for saved-region geometry.

Monitoring configurations retain an owner-scoped region, UTC five-field cron schedule, analysis type, and validated analysis parameters. Compose enables the APScheduler trigger, and `/api/regions/monitoring/{id}/run` also allows an authenticated manual run. Schedule expressions rerun the saved analysis parameters; choose up-to-date source observations when changing a configuration. Analysis execution uses FastAPI background tasks and PostgreSQL status/result persistence when `PERSIST_ANALYSIS_JOBS=true`; run one backend worker because APScheduler is process-local. For multi-worker execution, replace the in-process scheduler/task dispatch and ephemeral Earth Engine map objects with a distributed durable queue and regenerate map tokens from persisted source metadata.

### Tests and operational limits

Run the backend suite with `cd backend && pytest`. The numerical and mocked API tests do not require Earth Engine credentials. Real catalog, Earth Engine processing, and the full browser-to-PDF workflow require configured credentials and a running PostGIS service. The deployment PDF records source asset IDs, dates, method, measurements, quality/uncertainty, an AI interpretation when configured, and a vegetation change legend. It embeds before/after true-colour thumbnails when Earth Engine can render them, and report metadata records whether both were included. GeoJSON remains disabled because current change outputs are rasters.

## Deploy the web app and API to Vercel

`vercel.json` configures the repository's Vite app and FastAPI backend as Vercel Services. Requests under `/api` go to FastAPI; the remaining routes go to the Vite single-page app. API docs are available at `/docs`. The app uses Python 3.12 as selected by `.python-version`.

Import this repository into Vercel with the repository root as the project root, then set these environment variables before deploying:

- `VITE_API_BASE_URL=/api`
- `DATABASE_URL` to a managed PostgreSQL connection with PostGIS enabled (use the provider's pooled connection string for serverless workloads)
- `AUTH_SECRET` to a unique random value of at least 32 characters
- Earth Engine credentials (`GEE_PROJECT`, `GEE_AUTH_MODE`, `GEE_SERVICE_ACCOUNT`, and `GEE_PRIVATE_KEY_JSON`, or the credentials supported by your runtime identity)
- `PERSIST_ANALYSIS_JOBS=true` if analysis job status must survive function instances
- `REPORT_STORAGE_DIR=/tmp/terramind-reports` if report generation is enabled
- `MONITORING_SCHEDULER_ENABLED=false` and `MONITOR_SCHEDULER_ENABLED=false`; Vercel functions do not provide a persistent process for the in-process schedulers

The database schema must be migrated before protected database-backed endpoints are used (`cd backend && alembic upgrade head`). Vercel's function filesystem is temporary: reports written under `/tmp` are not durable, and Earth Engine tile-map objects remain process-local. Use durable object storage for generated report artifacts and a persistent worker/queue for scheduled monitoring before relying on those features in production. `vercel dev -L` runs the configured services locally without linking a Vercel project.
