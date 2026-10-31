/**
 * MapView – 2-D map powered by MapLibre GL JS.
 *
 * Basemap: OSM raster tiles (Stadia Maps CDN provides a clean OSM style).
 * Handles all selection modes and renders active selection as GeoJSON layers.
 */

import React, { useRef, useEffect, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useExplorerStore } from '@/store';
import {
  buildPointSelection,
  buildRectangleSelection,
  buildPolygonSelection,
  buildCircleSelection,
  validateSelection,
} from '@/utils/geoUtils';
import type { LngLat } from '@/types';

// OSM-compatible raster style – no API key needed
const OSM_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a> contributors',
      maxzoom: 19,
    },
  },
  layers: [
    {
      id: 'osm',
      type: 'raster',
      source: 'osm',
      minzoom: 0,
      maxzoom: 22,
    },
  ],
};

const SELECTION_SOURCE_ID = 'terramind-selection';
const SELECTION_FILL_LAYER = 'terramind-selection-fill';
const SELECTION_LINE_LAYER = 'terramind-selection-line';
const SELECTION_POINT_LAYER = 'terramind-selection-point';
const PREVIEW_SOURCE_ID = 'terramind-preview';
const PREVIEW_POINT_LAYER = 'terramind-preview-points';

export default function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  const selectionMode = useExplorerStore((s) => s.selectionMode);
  const selectionInProgress = useExplorerStore((s) => s.selectionInProgress);
  const activeSelection = useExplorerStore((s) => s.activeSelection);
  const layers = useExplorerStore((s) => s.layers);
  const initialCamera = useExplorerStore((s) => s.camera);

  const setActiveSelection = useExplorerStore((s) => s.setActiveSelection);
  const addSelectionPoint = useExplorerStore((s) => s.addSelectionPoint);
  const resetSelectionInProgress = useExplorerStore((s) => s.resetSelectionInProgress);
  const setCamera = useExplorerStore((s) => s.setCamera);

  // Drag state ref no longer needed - rectangle uses selectionInProgress store

  // ── Initialise map ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: OSM_STYLE,
      center: [initialCamera.longitude, initialCamera.latitude],
      zoom: 3,
      attributionControl: true,
    });

    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

    map.on('load', () => {
      // ── Selection source + layers ────────────────────────────────────────
      map.addSource(SELECTION_SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      map.addLayer({
        id: SELECTION_FILL_LAYER,
        type: 'fill',
        source: SELECTION_SOURCE_ID,
        filter: ['==', '$type', 'Polygon'],
        paint: {
          'fill-color': '#22d3ee',
          'fill-opacity': 0.2,
        },
      });

      map.addLayer({
        id: SELECTION_LINE_LAYER,
        type: 'line',
        source: SELECTION_SOURCE_ID,
        filter: ['==', '$type', 'Polygon'],
        paint: {
          'line-color': '#22d3ee',
          'line-width': 2,
        },
      });

      map.addLayer({
        id: SELECTION_POINT_LAYER,
        type: 'circle',
        source: SELECTION_SOURCE_ID,
        filter: ['==', '$type', 'Point'],
        paint: {
          'circle-radius': 8,
          'circle-color': '#22d3ee',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      });

      // ── Preview source (in-progress vertices) ───────────────────────────
      map.addSource(PREVIEW_SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      map.addLayer({
        id: PREVIEW_POINT_LAYER,
        type: 'circle',
        source: PREVIEW_SOURCE_ID,
        paint: {
          'circle-radius': 6,
          'circle-color': '#fbbf24',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1,
        },
      });
    });

    // Track camera movement
    map.on('moveend', () => {
      const c = map.getCenter();
      const z = map.getZoom();
      setCamera({ longitude: c.lng, latitude: c.lat, altitude: z });
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Sync active selection to map ──────────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const source = map.getSource(SELECTION_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (!source) return;

    if (!activeSelection) {
      source.setData({ type: 'FeatureCollection', features: [] });
      return;
    }

    source.setData({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: activeSelection.geometry as GeoJSON.Geometry,
          properties: activeSelection.properties,
        },
      ],
    });

    // Fly to selection
    if (activeSelection.geometry.type === 'Point') {
      const [lng, lat] = activeSelection.geometry.coordinates as LngLat;
      map.flyTo({ center: [lng, lat], zoom: 12, speed: 1.4 });
    } else if (activeSelection.geometry.type === 'Polygon') {
      const coords = (activeSelection.geometry.coordinates[0] as LngLat[]);
      const bounds = coords.reduce(
        (b, [lng, lat]) => b.extend([lng, lat] as [number, number]),
        new maplibregl.LngLatBounds(coords[0] as [number, number], coords[0] as [number, number])
      );
      map.fitBounds(bounds, { padding: 80, maxZoom: 14, duration: 800 });
    }
  }, [activeSelection]);

  // ── Sync in-progress polygon vertices ────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const source = map.getSource(PREVIEW_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (!source) return;

    source.setData({
      type: 'FeatureCollection',
      features: selectionInProgress.map(([lng, lat]) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lng, lat] },
        properties: {},
      })),
    });
  }, [selectionInProgress]);

  // ── Sync overlay layers ───────────────────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    layers
      .filter((l) => l.type === 'xyz' && l.url)
      .forEach((layer) => {
        const srcId = `overlay-${layer.id}`;
        const lyrId = `overlay-layer-${layer.id}`;

        if (!map.getSource(srcId)) {
          map.addSource(srcId, {
            type: 'raster',
            tiles: [layer.url!],
            tileSize: 256,
          });
          map.addLayer({
            id: lyrId,
            type: 'raster',
            source: srcId,
            layout: { visibility: layer.visible ? 'visible' : 'none' },
            paint: { 'raster-opacity': layer.opacity },
          });
        } else {
          if (map.getLayer(lyrId)) {
            map.setLayoutProperty(lyrId, 'visibility', layer.visible ? 'visible' : 'none');
            map.setPaintProperty(lyrId, 'raster-opacity', layer.opacity);
          }
        }
      });
  }, [layers]);

  // ── Cursor style ──────────────────────────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const canvas = map.getCanvas();
    canvas.style.cursor = selectionMode !== 'none' ? 'crosshair' : 'grab';
  }, [selectionMode]);

  // ── Click / drag handlers ─────────────────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const onClick = (e: maplibregl.MapMouseEvent) => {
      const lngLat: LngLat = [e.lngLat.lng, e.lngLat.lat];

      if (selectionMode === 'point') {
        setActiveSelection(buildPointSelection(lngLat));
        return;
      }

      if (selectionMode === 'circle') {
        if (selectionInProgress.length === 0) {
          addSelectionPoint(lngLat);
        } else {
          const centre = selectionInProgress[0];
          const from = maplibregl.MercatorCoordinate.fromLngLat({ lng: centre[0], lat: centre[1] });
          const to = maplibregl.MercatorCoordinate.fromLngLat({ lng: lngLat[0], lat: lngLat[1] });
          // Approximate distance in km
          const dx = (to.x - from.x) * 40075;
          const dy = (to.y - from.y) * 40075;
          const radiusKm = Math.sqrt(dx * dx + dy * dy);

          const sel = buildCircleSelection(centre, Math.max(0.1, radiusKm));
          const v = validateSelection(sel);
          if (v.valid) setActiveSelection(sel);
          else alert(v.reason);
          resetSelectionInProgress();
        }
        return;
      }

      if (selectionMode === 'polygon') {
        addSelectionPoint(lngLat);
        return;
      }

      if (selectionMode === 'rectangle') {
        if (selectionInProgress.length === 0) {
          addSelectionPoint(lngLat);
        } else {
          const sel = buildRectangleSelection(selectionInProgress[0], lngLat);
          const v = validateSelection(sel);
          if (v.valid) setActiveSelection(sel);
          else alert(v.reason);
          resetSelectionInProgress();
        }
      }
    };

    const onDblClick = (e: maplibregl.MapMouseEvent) => {
      if (selectionMode !== 'polygon') return;
      e.preventDefault();
      if (selectionInProgress.length < 3) return;
      const sel = buildPolygonSelection(selectionInProgress);
      if (!sel) {
        alert('Invalid polygon (self-intersecting). Please try again.');
        resetSelectionInProgress();
        return;
      }
      const v = validateSelection(sel);
      if (v.valid) setActiveSelection(sel);
      else alert(v.reason);
      resetSelectionInProgress();
    };

    map.on('click', onClick);
    map.on('dblclick', onDblClick);

    return () => {
      map.off('click', onClick);
      map.off('dblclick', onDblClick);
    };
  }, [selectionMode, selectionInProgress, addSelectionPoint, resetSelectionInProgress, setActiveSelection]);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%' }}
      aria-label="2D Map View"
    />
  );
}
