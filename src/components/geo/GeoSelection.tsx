/**
 * GeoSelection – reusable geographic selection widget.
 *
 * Embeds the Earth Explorer's selection tools into any page or modal.
 * Returns the selected GeoJSON (with explicit CRS) via the onChange callback.
 *
 * Usage:
 * ```tsx
 * <GeoSelection
 *   value={mySelection}
 *   onChange={(geojson) => console.log(geojson)}
 *   modes={['rectangle', 'polygon']}
 *   maxAreaSqKm={50000}
 * />
 * ```
 */

import React, { useEffect, useCallback } from 'react';
import { useExplorerStore } from '@/store';
import type { GeoJSONSelection, SelectionMode } from '@/types';
import ToolBar from '@/modules/explorer/ToolBar';
import GlobeView from '@/modules/explorer/GlobeView';
import MapView from '@/modules/explorer/MapView';
import SelectionInfoPanel from '@/modules/explorer/SelectionInfoPanel';
import styles from './GeoSelection.module.css';

export interface GeoSelectionProps {
  /** Controlled value – pass null to clear */
  value?: GeoJSONSelection | null;
  /** Fired whenever the user completes a new selection */
  onChange?: (selection: GeoJSONSelection | null) => void;
  /** Which selection modes to expose; defaults to all */
  modes?: SelectionMode[];
  /** Override the default 1 000 000 km² maximum */
  maxAreaSqKm?: number;
  /** Start in 2d or 3d mode */
  defaultViewMode?: '2d' | '3d';
  /** Pixel height of the embedded map */
  height?: number | string;
}

export default function GeoSelection({
  value,
  onChange,
  defaultViewMode = '3d',
  height = 480,
}: GeoSelectionProps) {
  const viewMode = useExplorerStore((s) => s.viewMode);
  const setViewMode = useExplorerStore((s) => s.setViewMode);
  const activeSelection = useExplorerStore((s) => s.activeSelection);
  const setActiveSelection = useExplorerStore((s) => s.setActiveSelection);

  // Initialise view mode
  useEffect(() => {
    setViewMode(defaultViewMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync controlled value into the store
  useEffect(() => {
    if (value !== undefined) {
      setActiveSelection(value ?? null);
    }
  }, [value, setActiveSelection]);

  // Notify parent when selection changes
  useEffect(() => {
    onChange?.(activeSelection);
  }, [activeSelection, onChange]);

  return (
    <div className={styles.container} style={{ height }}>
      {/* Map viewport */}
      <div className={styles.viewport}>
        {viewMode === '3d' ? <GlobeView /> : <MapView />}
      </div>

      {/* Controls overlay */}
      <div className={styles.overlay}>
        <ToolBar />
        <div className={styles.viewToggle}>
          <button
            className={`${styles.viewBtn} ${viewMode === '2d' ? styles.active : ''}`}
            onClick={() => setViewMode('2d')}
            aria-pressed={viewMode === '2d'}
          >
            2D
          </button>
          <button
            className={`${styles.viewBtn} ${viewMode === '3d' ? styles.active : ''}`}
            onClick={() => setViewMode('3d')}
            aria-pressed={viewMode === '3d'}
          >
            3D
          </button>
        </div>
        <SelectionInfoPanel />
      </div>
    </div>
  );
}
