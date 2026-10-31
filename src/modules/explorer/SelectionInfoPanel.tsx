/**
 * SelectionInfoPanel – bottom panel showing coordinates, area, and GeoJSON export.
 */

import { useState } from 'react';
import { useExplorerStore } from '@/store';
import { formatArea, formatCoordinates } from '@/utils/geoUtils';
import type { LngLat } from '@/types';
import styles from './SelectionInfoPanel.module.css';

export default function SelectionInfoPanel() {
  const showSelectionInfo = useExplorerStore((s) => s.showSelectionInfo);
  const setShowSelectionInfo = useExplorerStore((s) => s.setShowSelectionInfo);
  const activeSelection = useExplorerStore((s) => s.activeSelection);
  const clearSelection = useExplorerStore((s) => s.clearSelection);

  const [copied, setCopied] = useState(false);

  if (!showSelectionInfo || !activeSelection) return null;

  const { selectionType, areaSqKm, createdAt, center, radiusKm } =
    activeSelection.properties;
  const geomType = activeSelection.geometry.type;

  // Get a representative coordinate to display
  let displayCoord: LngLat | null = null;
  if (geomType === 'Point') {
    displayCoord = activeSelection.geometry.coordinates as LngLat;
  } else if (selectionType === 'circle' && center) {
    displayCoord = center;
  } else if (geomType === 'Polygon') {
    // centroid: average of ring coordinates
    const ring = (activeSelection.geometry as any).coordinates[0] as LngLat[];
    const sumLng = ring.reduce((s, c) => s + c[0], 0);
    const sumLat = ring.reduce((s, c) => s + c[1], 0);
    displayCoord = [sumLng / ring.length, sumLat / ring.length];
  }

  const geoJsonStr = JSON.stringify(activeSelection, null, 2);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(geoJsonStr);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for non-secure contexts
      const ta = document.createElement('textarea');
      ta.value = geoJsonStr;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const selectionTypeLabels: Record<string, string> = {
    point: 'Point',
    rectangle: 'Rectangle',
    polygon: 'Polygon',
    circle: 'Circle',
  };

  return (
    <div className={styles.panel} role="region" aria-label="Selection information">
      <header className={styles.header}>
        <div className={styles.typeChip}>{selectionTypeLabels[selectionType] ?? selectionType}</div>
        <div className={styles.headerRight}>
          <button
            className={styles.iconBtn}
            onClick={handleCopy}
            title="Copy GeoJSON to clipboard"
            aria-label={copied ? 'Copied!' : 'Copy GeoJSON'}
          >
            {copied ? (
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <polyline points="3,10 8,15 17,5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <rect x="7" y="3" width="10" height="13" rx="1" stroke="currentColor" strokeWidth="1.5" />
                <path d="M5 6H4a1 1 0 00-1 1v10a1 1 0 001 1h9a1 1 0 001-1v-1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            )}
          </button>
          <button
            className={styles.iconBtn}
            onClick={() => setShowSelectionInfo(false)}
            aria-label="Minimise panel"
            title="Minimise"
          >
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <line x1="4" y1="10" x2="16" y2="10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
          <button
            className={styles.iconBtn}
            onClick={clearSelection}
            aria-label="Clear selection"
            title="Clear selection"
          >
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <line x1="5" y1="5" x2="15" y2="15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="15" y1="5" x2="5" y2="15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </header>

      <div className={styles.stats}>
        {displayCoord && (
          <Stat
            label="Coordinates"
            value={formatCoordinates(displayCoord)}
            mono
          />
        )}
        {areaSqKm !== null && (
          <Stat label="Area" value={formatArea(areaSqKm)} />
        )}
        {selectionType === 'circle' && radiusKm !== undefined && (
          <Stat
            label="Radius"
            value={
              radiusKm < 1
                ? `${(radiusKm * 1000).toFixed(0)} m`
                : `${radiusKm.toFixed(2)} km`
            }
          />
        )}
        <Stat
          label="CRS"
          value="WGS 84 (EPSG:4326)"
          mono
        />
        <Stat
          label="Created"
          value={new Date(createdAt).toLocaleTimeString()}
        />
      </div>

      {copied && (
        <div className={styles.toast} role="status" aria-live="polite">
          GeoJSON copied to clipboard ✓
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={`${styles.statValue} ${mono ? styles.mono : ''}`}>{value}</span>
    </div>
  );
}
