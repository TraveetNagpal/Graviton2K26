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
│   └── dashboard/         ← Module 1 placeholder (replace in place)
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

    const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/analysis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        geometry: selection,        // GeoJSON Feature with CRS
        analysisType: 'vegetation',
        dateRange: { start: '2024-01-01', end: '2024-12-31' },
      }),
    });

    const result = await response.json();
    // result.tileUrl → pass to updateLayerUrl() in the store
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

## Adding Module 1 (Dashboard)

Module 1 is already wired into routing:

1. Open `src/modules/dashboard/Dashboard.tsx`
2. Replace its contents with your dashboard implementation
3. No changes to `App.tsx`, `AppShell.tsx`, or any Explorer file are needed

The nav link **Dashboard → /dashboard** already exists in `AppShell`.

---

## Map Credentials

| Service | Required | How to configure |
|---------|----------|-----------------|
| OpenStreetMap tiles | No | Used by default, no key needed |
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
