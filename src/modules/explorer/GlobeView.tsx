/**
 * GlobeView – 3-D interactive globe powered by CesiumJS (via Resium).
 *
 * Basemap: OpenStreetMap tiles (no Cesium Ion token required).
 * Terrain: Ellipsoid (flat) by default; swap in a terrain provider if desired.
 *
 * Handles:
 *  - Point selection
 *  - Rectangle selection (click-drag)
 *  - Polygon selection (click to add vertices, double-click to close)
 *  - Circle selection (click centre, then click edge to set radius)
 *  - Rendering active selection as a Cesium entity
 */

import { useRef, useCallback, useEffect } from 'react';
import {
  Viewer,
  Entity,
  PointGraphics,
  PolygonGraphics,
  ImageryLayer,
} from 'resium';
import {
  Ion,
  UrlTemplateImageryProvider,
  OpenStreetMapImageryProvider,
  Color,
  Cartesian3,
  Math as CesiumMath,
  ScreenSpaceEventType,
  EllipsoidTerrainProvider,
  PolygonHierarchy,
} from 'cesium';
import { useExplorerStore } from '@/store';
import {
  buildPointSelection,
  buildRectangleSelection,
  buildPolygonSelection,
  buildCircleSelection,
  validateSelection,
} from '@/utils/geoUtils';
import type { LngLat } from '@/types';

// Suppress Cesium Ion token warning – we use OSM tiles only
Ion.defaultAccessToken = import.meta.env.VITE_CESIUM_ION_TOKEN ?? '';

// Convert Cesium Cartesian3 to [lng, lat]
function cartesianToLngLat(cartesian: Cartesian3, viewer: any): LngLat | null {
  const ellipsoid = viewer.scene.globe.ellipsoid;
  const cartographic = ellipsoid.cartesianToCartographic(cartesian);
  if (!cartographic) return null;
  return [
    CesiumMath.toDegrees(cartographic.longitude),
    CesiumMath.toDegrees(cartographic.latitude),
  ];
}

export default function GlobeView() {
  const viewerRef = useRef<any>(null);

  const selectionMode = useExplorerStore((s) => s.selectionMode);
  const selectionInProgress = useExplorerStore((s) => s.selectionInProgress);
  const activeSelection = useExplorerStore((s) => s.activeSelection);
  const layers = useExplorerStore((s) => s.layers);

  const setActiveSelection = useExplorerStore((s) => s.setActiveSelection);
  const addSelectionPoint = useExplorerStore((s) => s.addSelectionPoint);
  const resetSelectionInProgress = useExplorerStore((s) => s.resetSelectionInProgress);

  // ── Click handler ──────────────────────────────────────────────────────────

  const handleMapClick = useCallback(
    (position: { x: number; y: number }) => {
      const viewer = viewerRef.current?.cesiumElement;
      if (!viewer) return;

      const cartesian = viewer.camera.pickEllipsoid(position, viewer.scene.globe.ellipsoid);
      if (!cartesian) return;

      const lngLat = cartesianToLngLat(cartesian, viewer);
      if (!lngLat) return;

      if (selectionMode === 'point') {
        const sel = buildPointSelection(lngLat);
        setActiveSelection(sel);
        return;
      }

      if (selectionMode === 'rectangle') {
        if (selectionInProgress.length === 0) {
          addSelectionPoint(lngLat);
        } else {
          const sel = buildRectangleSelection(selectionInProgress[0], lngLat);
          const validation = validateSelection(sel);
          if (validation.valid) {
            setActiveSelection(sel);
          } else {
            alert(validation.reason);
          }
          resetSelectionInProgress();
        }
        return;
      }

      if (selectionMode === 'circle') {
        if (selectionInProgress.length === 0) {
          addSelectionPoint(lngLat); // centre
        } else {
          const centre = selectionInProgress[0];
          // Approximate radius using haversine distance
          const R = 6371; // km
          const dLat = CesiumMath.toRadians(lngLat[1] - centre[1]);
          const dLng = CesiumMath.toRadians(lngLat[0] - centre[0]);
          const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos(CesiumMath.toRadians(centre[1])) *
              Math.cos(CesiumMath.toRadians(lngLat[1])) *
              Math.sin(dLng / 2) ** 2;
          const radiusKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

          const sel = buildCircleSelection(centre, radiusKm);
          const validation = validateSelection(sel);
          if (validation.valid) {
            setActiveSelection(sel);
          } else {
            alert(validation.reason);
          }
          resetSelectionInProgress();
        }
        return;
      }

      if (selectionMode === 'polygon') {
        addSelectionPoint(lngLat);
      }
    },
    [selectionMode, selectionInProgress, addSelectionPoint, resetSelectionInProgress, setActiveSelection]
  );

  // Double-click closes polygon
  const handleMapDblClick = useCallback(
    (_position: { x: number; y: number }) => {
      if (selectionMode !== 'polygon') return;
      const viewer = viewerRef.current?.cesiumElement;
      if (!viewer) return;

      if (selectionInProgress.length >= 3) {
        const sel = buildPolygonSelection(selectionInProgress);
        if (!sel) {
          alert('The polygon is self-intersecting or invalid. Please try again.');
          resetSelectionInProgress();
          return;
        }
        const validation = validateSelection(sel);
        if (!validation.valid) {
          alert(validation.reason);
          resetSelectionInProgress();
          return;
        }
        setActiveSelection(sel);
        resetSelectionInProgress();
      }
    },
    [selectionMode, selectionInProgress, setActiveSelection, resetSelectionInProgress]
  );

  // ── Register Cesium screen-space event handlers ────────────────────────────
  // We use a ref-based approach: re-register whenever handlers change.

  const handlersRef = useRef({ handleMapClick, handleMapDblClick });
  handlersRef.current = { handleMapClick, handleMapDblClick };

  const registerHandlers = useCallback(() => {
    const viewer = viewerRef.current?.cesiumElement;
    if (!viewer) return;

    const handler = viewer.screenSpaceEventHandler;

    handler.setInputAction(
      (event: { position: { x: number; y: number } }) =>
        handlersRef.current.handleMapClick(event.position),
      ScreenSpaceEventType.LEFT_CLICK
    );

    handler.setInputAction(
      (event: { position: { x: number; y: number } }) =>
        handlersRef.current.handleMapDblClick(event.position),
      ScreenSpaceEventType.LEFT_DOUBLE_CLICK
    );
  }, []);

  // Re-register on mode change (also fires after first mount via onReady)
  useEffect(() => {
    registerHandlers();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionMode]);

  // ── Build Cesium entities from active selection ───────────────────────────

  const selGeom = activeSelection?.geometry;
  const isPolygon = selGeom?.type === 'Polygon';
  const isPoint = selGeom?.type === 'Point';

  const polygonHierarchy = isPolygon
    ? new PolygonHierarchy(
        (selGeom as any).coordinates[0].map(([lng, lat]: LngLat) =>
          Cartesian3.fromDegrees(lng, lat)
        )
      )
    : null;

  const pointPos = isPoint
    ? Cartesian3.fromDegrees(
        (selGeom as any).coordinates[0] as number,
        (selGeom as any).coordinates[1] as number
      )
    : undefined;

  // ── In-progress polygon preview points ────────────────────────────────────

  const previewPositions = selectionInProgress.map(([lng, lat]) =>
    Cartesian3.fromDegrees(lng, lat)
  );

  // ── Visible imagery layers ─────────────────────────────────────────────────

  const visibleRasterLayers = layers.filter(
    (l) => l.visible && l.type === 'xyz' && l.url && l.id !== 'basemap-osm'
  );

  return (
    <Viewer
      ref={viewerRef}
      full
      timeline={false}
      animation={false}
      homeButton={false}
      navigationHelpButton={false}
      sceneModePicker={false}
      baseLayerPicker={false}
      geocoder={false}
      infoBox={false}
      selectionIndicator={false}
      baseLayer={false}
      // Flat ellipsoid terrain – replace with a terrain provider if desired
      terrainProvider={new EllipsoidTerrainProvider()}
      style={{ width: '100%', height: '100%' }}
    >
      <ImageryLayer
        imageryProvider={new OpenStreetMapImageryProvider({
          url: 'https://tile.openstreetmap.org/',
          credit: '© OpenStreetMap contributors',
        })}
      />
      {/* Satellite / analysis overlay layers */}
      {visibleRasterLayers.map((layer) => (
        <ImageryLayer
          key={layer.id}
          imageryProvider={
            new UrlTemplateImageryProvider({
              url: layer.url!,
              credit: layer.name,
            })
          }
          alpha={layer.opacity}
        />
      ))}

      {/* Active selection – polygon / rectangle */}
      {isPolygon && polygonHierarchy && (
        <Entity>
          <PolygonGraphics
            hierarchy={polygonHierarchy}
            material={Color.fromCssColorString('#22d3ee').withAlpha(0.25)}
            outline
            outlineColor={Color.fromCssColorString('#22d3ee')}
            outlineWidth={2}
          />
        </Entity>
      )}

      {/* Active selection – point */}
      {isPoint && pointPos && (
        <Entity position={pointPos}>
          <PointGraphics
            pixelSize={12}
            color={Color.fromCssColorString('#22d3ee')}
            outlineColor={Color.WHITE}
            outlineWidth={2}
          />
        </Entity>
      )}

      {/* In-progress polygon vertices */}
      {previewPositions.map((pos, i) => (
        <Entity key={i} position={pos}>
          <PointGraphics
            pixelSize={8}
            color={Color.fromCssColorString('#fbbf24')}
            outlineColor={Color.WHITE}
            outlineWidth={1}
          />
        </Entity>
      ))}
    </Viewer>
  );
}
