/**
 * Shared geographic types used throughout TerraMind AI.
 * All coordinates use EPSG:4326 (WGS 84) unless noted.
 */

export type LngLat = [number, number]; // [longitude, latitude]
export type LngLatAlt = [number, number, number]; // [longitude, latitude, altitude]

// ── GeoJSON selection shapes ────────────────────────────────────────────────

export interface PointSelection {
  type: 'Point';
  coordinates: LngLat;
}

export interface RectangleSelection {
  type: 'Polygon';
  /** Exactly 5 positions forming a closed rectangle (CCW winding). */
  coordinates: [LngLat, LngLat, LngLat, LngLat, LngLat][];
}

export interface PolygonSelection {
  type: 'Polygon';
  coordinates: LngLat[][];
}

export interface CircleSelection {
  type: 'Feature';
  geometry: PolygonSelection; // Circle approximated as 64-point polygon
  properties: {
    selectionType: 'circle';
    center: LngLat;
    radiusKm: number;
  };
}

export type SelectionGeometry =
  | PointSelection
  | RectangleSelection
  | PolygonSelection;

export type SelectionMode = 'none' | 'point' | 'rectangle' | 'polygon' | 'circle';

// ── GeoJSON feature with CRS ─────────────────────────────────────────────────

export interface GeoJSONSelection {
  type: 'Feature';
  geometry: SelectionGeometry | PolygonSelection;
  properties: {
    selectionType: SelectionMode;
    /** Area in km² (null for point selections) */
    areaSqKm: number | null;
    /** ISO 8601 timestamp when the selection was made */
    createdAt: string;
    /** Circle-specific fields */
    center?: LngLat;
    radiusKm?: number;
  };
  /** Explicit CRS declaration for backend compatibility */
  crs: {
    type: 'name';
    properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' };
  };
}

// ── Layer system ─────────────────────────────────────────────────────────────

export type LayerCategory =
  | 'basemap'
  | 'satellite'
  | 'vegetation'
  | 'water'
  | 'urban'
  | 'change';

export type LayerType = 'raster' | 'vector' | 'wms' | 'wmts' | 'xyz';

export interface MapLayer {
  id: string;
  name: string;
  category: LayerCategory;
  type: LayerType;
  visible: boolean;
  opacity: number;
  /** URL template or WMS endpoint */
  url?: string;
  /** WMS-specific params */
  wmsParams?: Record<string, string>;
  /** Legend color stops */
  legend?: LegendEntry[];
  /** Whether this layer requires a backend analysis request */
  requiresAnalysis?: boolean;
  /** Date range for before/after imagery */
  dateRange?: { before: string; after: string };
}

export interface LegendEntry {
  color: string;
  label: string;
  value?: number;
}

// ── Location search ───────────────────────────────────────────────────────────

export interface SearchResult {
  id: string;
  name: string;
  displayName: string;
  type: 'city' | 'region' | 'country' | 'coordinates' | 'feature';
  lngLat: LngLat;
  bbox?: [number, number, number, number]; // [west, south, east, north]
}

// ── Map state ─────────────────────────────────────────────────────────────────

export interface CameraState {
  longitude: number;
  latitude: number;
  altitude: number; // metres (3D) / zoom level mapped to alt
  heading: number;
  pitch: number;
  roll: number;
}

export type ViewMode = '2d' | '3d';
