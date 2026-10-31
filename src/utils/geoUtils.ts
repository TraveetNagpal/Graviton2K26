/**
 * Geometric utility functions for the Interactive Earth Explorer.
 * Calculations use @turf/turf; all coordinates are WGS 84 (EPSG:4326).
 */

import * as turf from '@turf/turf';
import type { Feature, Polygon } from 'geojson';
import type {
  LngLat,
  GeoJSONSelection,
  SelectionMode,
  PolygonSelection,
} from '@/types';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Maximum analysis area in km² (1 000 000 km² ≈ Texas × 1.4) */
export const MAX_AREA_SQ_KM = 1_000_000;

/** Minimum meaningful area in km² (10 × 10 m) */
export const MIN_AREA_SQ_KM = 0.0001;

/** CRS object appended to every GeoJSON output */
const CRS_WGS84 = {
  type: 'name' as const,
  properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' as const },
};

// ── Geometry builders ─────────────────────────────────────────────────────────

/**
 * Build a GeoJSONSelection from a single clicked point.
 */
export function buildPointSelection(lngLat: LngLat): GeoJSONSelection {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: lngLat },
    properties: {
      selectionType: 'point',
      areaSqKm: null,
      createdAt: new Date().toISOString(),
    },
    crs: CRS_WGS84,
  };
}

/**
 * Build a GeoJSONSelection from two opposite corners of a rectangle.
 * Corners are in [lng, lat] order.
 */
export function buildRectangleSelection(
  corner1: LngLat,
  corner2: LngLat
): GeoJSONSelection {
  const west = Math.min(corner1[0], corner2[0]);
  const east = Math.max(corner1[0], corner2[0]);
  const south = Math.min(corner1[1], corner2[1]);
  const north = Math.max(corner1[1], corner2[1]);

  const ring: LngLat[] = [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south], // close
  ];

  const geometry: PolygonSelection = {
    type: 'Polygon',
    coordinates: [ring],
  };

  const feature: Feature<Polygon> = { type: 'Feature', geometry, properties: {} };
  const areaSqKm = turf.area(feature) / 1_000_000;

  return {
    type: 'Feature',
    geometry,
    properties: {
      selectionType: 'rectangle',
      areaSqKm,
      createdAt: new Date().toISOString(),
    },
    crs: CRS_WGS84,
  };
}

/**
 * Build a GeoJSONSelection from an array of polygon vertices.
 * The ring is auto-closed if the first and last points differ.
 */
export function buildPolygonSelection(vertices: LngLat[]): GeoJSONSelection | null {
  if (vertices.length < 3) return null;

  const ring = [...vertices];
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    ring.push([first[0], first[1]]);
  }

  const geometry: PolygonSelection = {
    type: 'Polygon',
    coordinates: [ring],
  };

  try {
    const feature: Feature<Polygon> = { type: 'Feature', geometry, properties: {} };
    // Validate: must not be self-intersecting (kinks check)
    const kinks = turf.kinks(feature);
    if (kinks.features.length > 0) return null;

    const areaSqKm = turf.area(feature) / 1_000_000;

    return {
      type: 'Feature',
      geometry,
      properties: {
        selectionType: 'polygon',
        areaSqKm,
        createdAt: new Date().toISOString(),
      },
      crs: CRS_WGS84,
    };
  } catch {
    return null;
  }
}

/**
 * Build a GeoJSONSelection from a center point and radius in kilometres.
 * The circle is approximated as a 64-sided polygon.
 */
export function buildCircleSelection(
  center: LngLat,
  radiusKm: number
): GeoJSONSelection {
  const circle = turf.circle(center, radiusKm, { steps: 64, units: 'kilometers' });
  const areaSqKm = turf.area(circle) / 1_000_000;

  return {
    type: 'Feature',
    geometry: circle.geometry as PolygonSelection,
    properties: {
      selectionType: 'circle',
      areaSqKm,
      createdAt: new Date().toISOString(),
      center,
      radiusKm,
    },
    crs: CRS_WGS84,
  };
}

// ── Validation ────────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

export function validateSelection(sel: GeoJSONSelection): ValidationResult {
  const { areaSqKm } = sel.properties;
  if (areaSqKm === null) return { valid: true }; // point – always valid

  if (areaSqKm < MIN_AREA_SQ_KM) {
    return { valid: false, reason: 'Selected area is too small for analysis.' };
  }
  if (areaSqKm > MAX_AREA_SQ_KM) {
    return {
      valid: false,
      reason: `Selected area (${formatArea(areaSqKm)}) exceeds the maximum analysis area of ${formatArea(MAX_AREA_SQ_KM)}.`,
    };
  }
  return { valid: true };
}

// ── Formatting ────────────────────────────────────────────────────────────────

export function formatArea(sqKm: number): string {
  if (sqKm < 0.01) return `${(sqKm * 1_000_000).toFixed(0)} m²`;
  if (sqKm < 1) return `${(sqKm * 100).toFixed(2)} ha`;
  if (sqKm >= 1_000_000) return `${(sqKm / 1_000_000).toFixed(2)} M km²`;
  if (sqKm >= 1_000) return `${(sqKm / 1_000).toFixed(2)} × 10³ km²`;
  return `${sqKm.toFixed(2)} km²`;
}

export function formatCoordinates(lngLat: LngLat): string {
  const [lng, lat] = lngLat;
  const latDir = lat >= 0 ? 'N' : 'S';
  const lngDir = lng >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(5)}° ${latDir}, ${Math.abs(lng).toFixed(5)}° ${lngDir}`;
}

// ── Search helpers ────────────────────────────────────────────────────────────

/**
 * Parse a raw string like "40.7128, -74.0060" or "-74.0060 40.7128"
 * and return a LngLat if it looks like a coordinate pair, else null.
 */
export function tryParseCoordinates(input: string): LngLat | null {
  const cleaned = input.replace(/[°NSEW]/gi, '').trim();
  const parts = cleaned.split(/[\s,;]+/).map(Number);
  if (parts.length !== 2 || parts.some(isNaN)) return null;

  const [a, b] = parts;
  // Heuristic: if |a| <= 90 and |b| <= 180, treat as [lat, lng] and swap
  if (Math.abs(a) <= 90 && Math.abs(b) <= 180) {
    return [b, a]; // return as [lng, lat]
  }
  if (Math.abs(a) <= 180 && Math.abs(b) <= 90) {
    return [a, b];
  }
  return null;
}

/**
 * Returns the cursor CSS class for a given selection mode.
 */
export function cursorForMode(mode: SelectionMode): string {
  switch (mode) {
    case 'point': return 'cursor-crosshair';
    case 'rectangle': return 'cursor-cell';
    case 'polygon': return 'cursor-crosshair';
    case 'circle': return 'cursor-crosshair';
    default: return 'cursor-default';
  }
}
