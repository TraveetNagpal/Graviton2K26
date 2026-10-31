# TerraMind AI – Map Integration Guide

## Overview

Module 2 – **Interactive Earth Explorer** – is a self-contained feature module built with CesiumJS (3D globe) and MapLibre GL JS (2D map). It exposes a reusable `GeoSelection` component and `useGeoSelection` hook that any other module can consume.

---

## Architecture

```
src/
├── modules/
│   ├── explorer/          ← Module 2 (Interactive Earth Explorer)
│   │   ├── EarthExplorer.tsx      Root page component
│   │   ├── GlobeView.tsx          CesiumJS 3-D globe
│   │   ├── MapView.tsx            MapLibre GL 2-D map
│   │   ├── SearchBar.tsx          Geocoding search (Nominatim)
│   │   ├── ToolBar.tsx            Selection tools (Point/Rectangle/Polygon/Circle)
│   │   ├── MapControls.tsx        2D/3D toggle, layers, fullscreen
│   │   ├── LayerPanel.tsx         Layer visibility + opacity
│   │   ├── SelectionInfoPanel.tsx Coordinates, area, GeoJSON export
│   │   └── LegendPanel.tsx        Colour legend for active layers
│   └── dashboard/         ← Dashboard overview and service health
│
├── components/
│   └── geo/
│       ├── GeoSelection.tsx       Reusable embedded selection widget
│       ├── useGeoSelection.ts     Hook for headless selection state
│       └── index.ts
│
├── store/
│   └── explorerStore.ts           Zustand store (shared state)
│
├── types/
│   └── geo.ts                     Shared TypeScript types
│
└── utils/
    ├── geoUtils.ts                Geometry builders + validation
    └── geocode.ts                 Nominatim geocoding
```

---

## Selection GeoJSON Output

Every selection is returned as a GeoJSON `Feature` with an explicit CRS:

```json
{
  "type": "Feature",
  "geometry": {
    "type": "Polygon",
    "coordinates": [[...]]
  },
  "properties": {
    "selectionType": "rectangle",
    "areaSqKm": 12345.67,
    "createdAt": "2026-10-31T12:00:00.000Z"
  },
  "crs": {
    "type": "name",
    "properties": {
      "name": "urn:ogc:def:crs:OGC:1.3:CRS84"
    }
  }
}
```

**CRS**: All coordinates use WGS 84 (EPSG:4326) in `[longitude, latitude]` order, matching the GeoJSON specification (RFC 7946) and OGC CRS84. This is the expected format for the TerraMind backend API.

---

## Sending a Selection to the Backend

```ts
import { useGeoSelection } from '@/components/geo';

function AnalysisForm() {
  const { selection } = useGeoSelection();

  const runAnalysis = async () => {
    if (!selection) return;

    const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/satellite/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        area_of_interest: selection.geometry, // GeoJSON Polygon, WGS84
        dataset: 'sentinel-2',
        start_date: '2025-01-01',
        end_date: '2026-01-01', // exclusive
        max_cloud_cover: 30,
      }),
    });

    const { observations } = await response.json(); // actual Earth Engine catalog assets
    // Select two returned image_id values in chronological order, then POST
    // /api/analysis/vegetation with their IDs/datasets and area_of_interest.
  };
}
```

---

## Embedding the Selection Widget

Use `GeoSelection` to embed a mini-map picker inside a form or modal:

```tsx
import { GeoSelection } from '@/components/geo';
import type { GeoJSONSelection } from '@/types';
import { useState } from 'react';

export function RegionPicker() {
  const [region, setRegion] = useState<GeoJSONSelection | null>(null);

  return (
    <div>
      <GeoSelection
        value={region}
        onChange={setRegion}
        defaultViewMode="2d"
        height={400}
      />
      {region && (
        <pre>{JSON.stringify(region.properties, null, 2)}</pre>
      )}
    </div>
  );
}
```

---

## Displaying Backend Imagery

When the backend returns a tile URL for an analysis layer, update it in the store:

```ts
import { useExplorerStore } from '@/store';

const updateLayerUrl = useExplorerStore((s) => s.updateLayerUrl);
const toggleLayerVisibility = useExplorerStore((s) => s.toggleLayerVisibility);

// After receiving tile URL from API:
updateLayerUrl('vegetation-ndvi', 'https://tiles.terramind.ai/ndvi/{z}/{x}/{y}.png');
toggleLayerVisibility('vegetation-ndvi'); // make it visible
```

The 2D (MapLibre) and 3D (CesiumJS) views both consume layer URLs from the store and render them automatically.

---

## Before/After Imagery

Set the date range on the `change-before-after` layer to trigger a backend request:

```ts
import { useExplorerStore } from '@/store';

const store = useExplorerStore.getState();
store.updateLayerUrl('change-before-after', apiResponse.tileUrl);
// Then update the dateRange field if needed
```

---

## Module 9 – Reports and exports

The Reports page is available at `/reports`. It expects the API base URL in
`VITE_API_BASE_URL`; for example, `http://localhost:8000/api` maps to the
following report endpoints. Authentication is disabled; reports belong to a
single shared workspace.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/reports/generate` | Validate a completed source analysis and generate artifacts |
| GET | `/api/reports` | List workspace reports |
| GET | `/api/reports/{report_id}` | Read a report and its metadata |
| GET | `/api/reports/{report_id}/download?format=pdf\|csv\|geojson` | Secure artifact download |

Report list, detail, and download queries are scoped to the shared workspace.
Generation also verifies that the source analysis belongs to that workspace.

Generation request:

```json
{ "analysis_id": "analysis-123", "title": "Optional title", "formats": ["pdf", "csv"] }
```

The server rejects unknown or inaccessible analysis IDs; derives
region, observations, dataset, method, measurements, quality, interpretation,
uncertainty, and processing time from the stored analysis result; and omit
unavailable values instead of substituting zero. A completed response should
include a report record and only artifact formats supported by that analysis.
Downloads use the report download endpoint. Failed jobs should
include a useful `error` and `status: "failed"`.

The PDF is server-generated and contains source asset IDs, dates, analysis
method, measurements, a vegetation change legend, AI interpretation when
configured, methodology, quality and limitation notes, and page numbers. It
embeds before/after true-colour thumbnails when Earth Engine can render them
and records whether both were included; the raster layer endpoint remains the
source for interactive maps. CSV contains only available tabular measurements. GeoJSON is
exposed only for actual compatible vector output; raster tiles/images must
never be converted or advertised as GeoJSON. Downloads are served by the same
report download endpoint.

Example completed record:

```json
{
  "report": {
    "id": "report-456", "title": "Vegetation change", "region": "Punjab",
    "createdAt": "2026-10-31T10:00:00Z", "analysisType": "vegetation_change",
    "status": "completed", "observationDates": ["2025-01-01", "2026-01-01"],
    "analysisMethod": "NDVI differencing", "dataset": "Sentinel-2",
    "measurements": [{"name":"Area changed","value":12.4,"unit":"km²"}],
    "geojsonAvailable": false
  }
}
```

The browser client sends no credentials. Configure CORS for the deployment
origin. Because all visitors share one workspace, deploy this configuration
only in a trusted environment or add authentication before exposing it
publicly.

Saved regions and monitoring configurations are workspace-scoped PostGIS records.
Monitoring `schedule` uses a five-field UTC cron expression. When
`MONITORING_SCHEDULER_ENABLED=true`, the single backend process reruns the
validated parameters on that schedule; `/api/regions/monitoring/{id}/run`
provides a manual trigger. The current schedule reuses its
configured observation IDs, so update the configuration with newer observations
when you intend to monitor later acquisitions.

## Map Credentials

| Service | Required | How to configure |
|---------|----------|-----------------|
| OpenStreetMap tiles | No | Used by default, no key needed |
| Google Maps (satellite/roadmap 2D tiles) | Optional | Set `VITE_GOOGLE_MAPS_API_KEY` (restrict by HTTP referrer) and optionally `VITE_GOOGLE_MAPS_MAP_TYPE` |
| Cesium Ion (terrain / 3D tiles) | Optional | Set `VITE_CESIUM_ION_TOKEN` in `.env` |
| Stadia Maps (alternative OSM style) | Optional | Replace `OSM_STYLE` in `MapView.tsx` |

Copy `.env.example` to `.env` and fill in the values. The file is git-ignored; never commit real tokens.

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `P` | Point selection |
| `R` | Rectangle selection |
| `G` | Polygon selection |
| `C` | Circle selection |
| `Esc` | Cancel / clear selection |

---

## Validation Rules

| Rule | Limit |
|------|-------|
| Minimum area | 0.0001 km² (10 × 10 m) |
| Maximum area | 1 000 000 km² |
| Polygon validity | No self-intersections (turf.kinks check) |
| Polygon vertices | Minimum 3 before closing |
| Circle radius | Minimum 0.1 km |
