/**
 * EarthExplorer – Module 2 root component.
 *
 * Layout:
 *  ┌──────────────────────────────────┐
 *  │  SearchBar (top centre)          │
 *  │  ┌────────────────────────────┐  │
 *  │  │  Globe / Map viewport      │  │
 *  │  └────────────────────────────┘  │
 *  │  ToolBar (left)                  │
 *  │  MapControls (right)             │
 *  │  LayerPanel (right slide-over)   │
 *  │  SelectionInfoPanel (bottom)     │
 *  └──────────────────────────────────┘
 */

import React, { useCallback, useRef } from 'react';
import { useExplorerStore } from '@/store';
import GlobeView from './GlobeView';
import MapView from './MapView';
import SearchBar from './SearchBar';
import ToolBar from './ToolBar';
import MapControls from './MapControls';
import LayerPanel from './LayerPanel';
import SelectionInfoPanel from './SelectionInfoPanel';
import LegendPanel from './LegendPanel';
import HistoricalTimeline from './HistoricalTimeline';
import type { LngLat } from '@/types';
import styles from './EarthExplorer.module.css';

export default function EarthExplorer() {
  const viewMode = useExplorerStore((s) => s.viewMode);
  const isFullscreen = useExplorerStore((s) => s.isFullscreen);
  const setFullscreen = useExplorerStore((s) => s.setFullscreen);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
      setFullscreen(true);
    } else {
      document.exitFullscreen();
      setFullscreen(false);
    }
  }, [setFullscreen]);

  // Keep store in sync when browser exits fullscreen via Escape key
  React.useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement) setFullscreen(false);
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, [setFullscreen]);

  return (
    <div
      ref={containerRef}
      className={`${styles.container} ${isFullscreen ? styles.fullscreen : ''}`}
      aria-label="Interactive Earth Explorer"
    >
      {/* Map / Globe viewport */}
      <div className={styles.viewport}>
        {viewMode === '3d' ? <GlobeView /> : <MapView />}
      </div>

      {/* Overlaid controls */}
      <div className={styles.overlay} aria-hidden="false">
        <SearchBar />
        <ToolBar />
        <MapControls onFullscreen={handleFullscreen} />
        <LayerPanel />
        <SelectionInfoPanel />
        <LegendPanel />
        <HistoricalTimeline />
      </div>
    </div>
  );
}
