/**
 * Zustand store for the Interactive Earth Explorer module.
 * Manages view state, layer visibility, and selection geometry.
 */

import { create } from 'zustand';
import type {
  ViewMode,
  SelectionMode,
  GeoJSONSelection,
  MapLayer,
  CameraState,
  LngLat,
} from '@/types';

// ── Default layers ────────────────────────────────────────────────────────────

const DEFAULT_LAYERS: MapLayer[] = [
  {
    id: 'basemap-osm',
    name: 'OpenStreetMap',
    category: 'basemap',
    type: 'xyz',
    visible: true,
    opacity: 1,
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  },
  {
    id: 'satellite-esri',
    name: 'Satellite Imagery',
    category: 'satellite',
    type: 'xyz',
    visible: false,
    opacity: 1,
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  },
  {
    id: 'vegetation-ndvi',
    name: 'Vegetation (NDVI)',
    category: 'vegetation',
    type: 'raster',
    visible: false,
    opacity: 0.75,
    requiresAnalysis: true,
    legend: [
      { color: '#8B0000', label: 'No vegetation', value: 0 },
      { color: '#FFFF00', label: 'Sparse', value: 0.2 },
      { color: '#90EE90', label: 'Moderate', value: 0.5 },
      { color: '#006400', label: 'Dense', value: 1 },
    ],
  },
  {
    id: 'water-analysis',
    name: 'Water Bodies',
    category: 'water',
    type: 'raster',
    visible: false,
    opacity: 0.8,
    requiresAnalysis: true,
    legend: [
      { color: '#FFFFFF', label: 'Land' },
      { color: '#006994', label: 'Permanent water' },
      { color: '#87CEEB', label: 'Seasonal water' },
    ],
  },
  {
    id: 'urban-change',
    name: 'Urban Change',
    category: 'urban',
    type: 'raster',
    visible: false,
    opacity: 0.7,
    requiresAnalysis: true,
    legend: [
      { color: '#808080', label: 'No change' },
      { color: '#FF4500', label: 'New urban' },
      { color: '#32CD32', label: 'Vegetation gain' },
    ],
  },
  {
    id: 'change-before-after',
    name: 'Before/After Imagery',
    category: 'change',
    type: 'raster',
    visible: false,
    opacity: 1,
    requiresAnalysis: true,
    dateRange: { before: '', after: '' },
  },
];

// ── Store interface ───────────────────────────────────────────────────────────

export interface ExplorerState {
  // View
  viewMode: ViewMode;
  isFullscreen: boolean;
  camera: CameraState;

  // Selection
  selectionMode: SelectionMode;
  activeSelection: GeoJSONSelection | null;
  selectionInProgress: LngLat[]; // points collected so far for polygon drawing

  // Layers
  layers: MapLayer[];

  // UI
  showLayerPanel: boolean;
  showLegendPanel: boolean;
  showSelectionInfo: boolean;

  // Actions
  setViewMode: (mode: ViewMode) => void;
  setFullscreen: (v: boolean) => void;
  setCamera: (cam: Partial<CameraState>) => void;

  setSelectionMode: (mode: SelectionMode) => void;
  setActiveSelection: (sel: GeoJSONSelection | null) => void;
  clearSelection: () => void;
  addSelectionPoint: (pt: LngLat) => void;
  resetSelectionInProgress: () => void;

  toggleLayerVisibility: (id: string) => void;
  setLayerOpacity: (id: string, opacity: number) => void;
  updateLayerUrl: (id: string, url: string) => void;
  setAnalysisLayers: (layers: MapLayer[]) => void;

  setShowLayerPanel: (v: boolean) => void;
  setShowLegendPanel: (v: boolean) => void;
  setShowSelectionInfo: (v: boolean) => void;
}

export const useExplorerStore = create<ExplorerState>((set) => ({
  // View
  viewMode: '3d',
  isFullscreen: false,
  camera: {
    longitude: 0,
    latitude: 20,
    altitude: 20_000_000,
    heading: 0,
    pitch: -90,
    roll: 0,
  },

  // Selection
  selectionMode: 'none',
  activeSelection: null,
  selectionInProgress: [],

  // Layers
  layers: DEFAULT_LAYERS,

  // UI
  showLayerPanel: false,
  showLegendPanel: false,
  showSelectionInfo: false,

  // ── Actions ────────────────────────────────────────────────────────────────

  setViewMode: (viewMode) => set({ viewMode }),
  setFullscreen: (isFullscreen) => set({ isFullscreen }),
  setCamera: (cam) =>
    set((s) => ({ camera: { ...s.camera, ...cam } })),

  setSelectionMode: (selectionMode) =>
    set({ selectionMode, selectionInProgress: [] }),
  setActiveSelection: (activeSelection) =>
    set({ activeSelection, showSelectionInfo: activeSelection !== null }),
  clearSelection: () =>
    set({ activeSelection: null, selectionInProgress: [], showSelectionInfo: false }),
  addSelectionPoint: (pt) =>
    set((s) => ({ selectionInProgress: [...s.selectionInProgress, pt] })),
  resetSelectionInProgress: () => set({ selectionInProgress: [] }),

  toggleLayerVisibility: (id) =>
    set((s) => ({
      layers: s.layers.map((l) =>
        l.id === id ? { ...l, visible: !l.visible } : l
      ),
    })),
  setLayerOpacity: (id, opacity) =>
    set((s) => ({
      layers: s.layers.map((l) => (l.id === id ? { ...l, opacity } : l)),
    })),
  updateLayerUrl: (id, url) =>
    set((s) => ({
      layers: s.layers.map((l) => (l.id === id ? { ...l, url } : l)),
    })),
  setAnalysisLayers: (analysisLayers) => set((s) => ({
    layers: [
      ...s.layers.filter((layer) => !layer.id.startsWith('analysis-')),
      ...analysisLayers,
    ],
  })),

  setShowLayerPanel: (showLayerPanel) => set({ showLayerPanel }),
  setShowLegendPanel: (showLegendPanel) => set({ showLegendPanel }),
  setShowSelectionInfo: (showSelectionInfo) => set({ showSelectionInfo }),
}));
