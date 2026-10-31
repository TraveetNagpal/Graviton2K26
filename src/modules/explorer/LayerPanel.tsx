/**
 * LayerPanel – slide-over panel for controlling layer visibility, opacity,
 * and viewing backend integration status.
 */

import { useExplorerStore } from '@/store';
import type { MapLayer, LayerCategory } from '@/types';
import styles from './LayerPanel.module.css';

const CATEGORY_LABELS: Record<LayerCategory, string> = {
  basemap: 'Base Maps',
  satellite: 'Satellite Imagery',
  vegetation: 'Vegetation',
  water: 'Water',
  urban: 'Urban',
  change: 'Change Detection',
};

const CATEGORY_ORDER: LayerCategory[] = [
  'basemap',
  'satellite',
  'vegetation',
  'water',
  'urban',
  'change',
];

function groupByCategory(layers: MapLayer[]): Map<LayerCategory, MapLayer[]> {
  const map = new Map<LayerCategory, MapLayer[]>();
  for (const layer of layers) {
    if (!map.has(layer.category)) map.set(layer.category, []);
    map.get(layer.category)!.push(layer);
  }
  return map;
}

export default function LayerPanel() {
  const showLayerPanel = useExplorerStore((s) => s.showLayerPanel);
  const setShowLayerPanel = useExplorerStore((s) => s.setShowLayerPanel);
  const layers = useExplorerStore((s) => s.layers);
  const toggleLayerVisibility = useExplorerStore((s) => s.toggleLayerVisibility);
  const setLayerOpacity = useExplorerStore((s) => s.setLayerOpacity);

  const grouped = groupByCategory(layers);

  if (!showLayerPanel) return null;

  return (
    <aside className={styles.panel} aria-label="Layer control panel">
      <header className={styles.header}>
        <h2 className={styles.title}>Layers</h2>
        <button
          className={styles.closeBtn}
          onClick={() => setShowLayerPanel(false)}
          aria-label="Close layer panel"
        >
          ✕
        </button>
      </header>

      <div className={styles.body}>
        {CATEGORY_ORDER.map((cat) => {
          const catLayers = grouped.get(cat);
          if (!catLayers) return null;
          return (
            <section key={cat} className={styles.section}>
              <h3 className={styles.sectionTitle}>{CATEGORY_LABELS[cat]}</h3>
              {catLayers.map((layer) => (
                <LayerRow
                  key={layer.id}
                  layer={layer}
                  onToggle={() => toggleLayerVisibility(layer.id)}
                  onOpacity={(v) => setLayerOpacity(layer.id, v)}
                />
              ))}
            </section>
          );
        })}
      </div>
    </aside>
  );
}

interface LayerRowProps {
  layer: MapLayer;
  onToggle: () => void;
  onOpacity: (v: number) => void;
}

function LayerRow({ layer, onToggle, onOpacity }: LayerRowProps) {
  return (
    <div className={styles.layerRow}>
      <label className={styles.layerToggle}>
        <input
          type="checkbox"
          checked={layer.visible}
          onChange={onToggle}
          aria-label={`Toggle ${layer.name}`}
        />
        <span className={`${styles.checkmark} ${layer.visible ? styles.checked : ''}`} aria-hidden="true" />
        <span className={styles.layerName}>{layer.name}</span>
        {layer.requiresAnalysis && (
          <span className={styles.badge} title="Requires backend analysis request">
            API
          </span>
        )}
      </label>

      {layer.visible && (
        <div className={styles.opacityRow}>
          <span className={styles.opacityLabel}>Opacity</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={layer.opacity}
            onChange={(e) => onOpacity(parseFloat(e.target.value))}
            className={styles.opacitySlider}
            aria-label={`${layer.name} opacity`}
          />
          <span className={styles.opacityValue}>{Math.round(layer.opacity * 100)}%</span>
        </div>
      )}
    </div>
  );
}
