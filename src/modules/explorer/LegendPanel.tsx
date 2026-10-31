/**
 * LegendPanel – shows colour legends for all visible layers that have legend entries.
 */

import React from 'react';
import { useExplorerStore } from '@/store';
import styles from './LegendPanel.module.css';

export default function LegendPanel() {
  const showLegendPanel = useExplorerStore((s) => s.showLegendPanel);
  const setShowLegendPanel = useExplorerStore((s) => s.setShowLegendPanel);
  const layers = useExplorerStore((s) => s.layers);

  const legendLayers = layers.filter((l) => l.visible && l.legend && l.legend.length > 0);

  if (!showLegendPanel) return null;

  return (
    <aside className={styles.panel} aria-label="Map legend">
      <header className={styles.header}>
        <h2 className={styles.title}>Legend</h2>
        <button
          className={styles.closeBtn}
          onClick={() => setShowLegendPanel(false)}
          aria-label="Close legend"
        >
          ✕
        </button>
      </header>

      <div className={styles.body}>
        {legendLayers.length === 0 ? (
          <p className={styles.empty}>
            No active layers with legend data.
            <br />
            Enable an analysis layer to see its legend.
          </p>
        ) : (
          legendLayers.map((layer) => (
            <section key={layer.id} className={styles.section}>
              <h3 className={styles.sectionTitle}>{layer.name}</h3>
              {layer.legend!.map((entry, i) => (
                <div key={i} className={styles.entry}>
                  <span
                    className={styles.swatch}
                    style={{ background: entry.color }}
                    aria-hidden="true"
                  />
                  <span className={styles.entryLabel}>{entry.label}</span>
                </div>
              ))}
            </section>
          ))
        )}
      </div>
    </aside>
  );
}
