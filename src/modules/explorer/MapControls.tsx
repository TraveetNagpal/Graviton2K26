/**
 * MapControls – right-side panel: 2D/3D toggle, zoom, layers, fullscreen.
 */

import React from 'react';
import { useExplorerStore } from '@/store';
import styles from './MapControls.module.css';

interface MapControlsProps {
  onFullscreen: () => void;
}

export default function MapControls({ onFullscreen }: MapControlsProps) {
  const viewMode = useExplorerStore((s) => s.viewMode);
  const isFullscreen = useExplorerStore((s) => s.isFullscreen);
  const setViewMode = useExplorerStore((s) => s.setViewMode);
  const showLayerPanel = useExplorerStore((s) => s.showLayerPanel);
  const setShowLayerPanel = useExplorerStore((s) => s.setShowLayerPanel);
  const showLegendPanel = useExplorerStore((s) => s.showLegendPanel);
  const setShowLegendPanel = useExplorerStore((s) => s.setShowLegendPanel);

  return (
    <aside className={styles.controls} aria-label="Map controls">
      {/* 2D / 3D toggle */}
      <div className={styles.group}>
        <button
          className={`${styles.btn} ${viewMode === '2d' ? styles.active : ''}`}
          onClick={() => setViewMode('2d')}
          title="Switch to 2D map"
          aria-pressed={viewMode === '2d'}
          aria-label="2D view"
        >
          <span className={styles.modeLabel}>2D</span>
        </button>
        <button
          className={`${styles.btn} ${viewMode === '3d' ? styles.active : ''}`}
          onClick={() => setViewMode('3d')}
          title="Switch to 3D globe"
          aria-pressed={viewMode === '3d'}
          aria-label="3D globe"
        >
          <span className={styles.modeLabel}>3D</span>
        </button>
      </div>

      <div className={styles.divider} aria-hidden="true" />

      {/* Layers */}
      <div className={styles.group}>
        <button
          className={`${styles.btn} ${showLayerPanel ? styles.active : ''}`}
          onClick={() => setShowLayerPanel(!showLayerPanel)}
          title="Toggle layer panel (L)"
          aria-pressed={showLayerPanel}
          aria-label="Layer visibility"
        >
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <rect x="2" y="5" width="16" height="2" rx="1" fill="currentColor" />
            <rect x="2" y="9" width="16" height="2" rx="1" fill="currentColor" />
            <rect x="2" y="13" width="16" height="2" rx="1" fill="currentColor" />
          </svg>
        </button>

        {/* Legend */}
        <button
          className={`${styles.btn} ${showLegendPanel ? styles.active : ''}`}
          onClick={() => setShowLegendPanel(!showLegendPanel)}
          title="Toggle legend"
          aria-pressed={showLegendPanel}
          aria-label="Map legend"
        >
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <rect x="2" y="4" width="6" height="4" rx="1" fill="currentColor" opacity="0.7" />
            <rect x="2" y="12" width="6" height="4" rx="1" fill="currentColor" opacity="0.4" />
            <line x1="11" y1="6" x2="18" y2="6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="11" y1="14" x2="18" y2="14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className={styles.divider} aria-hidden="true" />

      {/* Fullscreen */}
      <div className={styles.group}>
        <button
          className={`${styles.btn} ${isFullscreen ? styles.active : ''}`}
          onClick={onFullscreen}
          title={isFullscreen ? 'Exit fullscreen (F11)' : 'Enter fullscreen (F11)'}
          aria-pressed={isFullscreen}
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        >
          {isFullscreen ? (
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <polyline points="7,3 3,3 3,7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <polyline points="13,3 17,3 17,7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <polyline points="7,17 3,17 3,13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <polyline points="13,17 17,17 17,13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <polyline points="3,7 3,3 7,3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <polyline points="17,7 17,3 13,3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <polyline points="3,13 3,17 7,17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <polyline points="17,13 17,17 13,17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
      </div>
    </aside>
  );
}
