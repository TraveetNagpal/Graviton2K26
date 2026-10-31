/**
 * ToolBar – vertical panel on the left for area-selection tools.
 */

import React from 'react';
import { useExplorerStore } from '@/store';
import type { SelectionMode } from '@/types';
import styles from './ToolBar.module.css';

interface Tool {
  mode: SelectionMode;
  label: string;
  title: string;
  icon: React.ReactNode;
}

const TOOLS: Tool[] = [
  {
    mode: 'point',
    label: 'Point',
    title: 'Select a point (P)',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <circle cx="10" cy="10" r="3.5" stroke="currentColor" strokeWidth="1.5" />
        <line x1="10" y1="2" x2="10" y2="6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <line x1="10" y1="14" x2="10" y2="18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <line x1="2" y1="10" x2="6" y2="10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <line x1="14" y1="10" x2="18" y2="10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    mode: 'rectangle',
    label: 'Rectangle',
    title: 'Draw a rectangle (R)',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <rect x="3" y="5" width="14" height="10" rx="1" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="3" cy="5" r="1.5" fill="currentColor" />
        <circle cx="17" cy="5" r="1.5" fill="currentColor" />
        <circle cx="3" cy="15" r="1.5" fill="currentColor" />
        <circle cx="17" cy="15" r="1.5" fill="currentColor" />
      </svg>
    ),
  },
  {
    mode: 'polygon',
    label: 'Polygon',
    title: 'Draw a polygon – click to add vertices, double-click to close (G)',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <polygon
          points="10,3 17,8 14,16 6,16 3,8"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <circle cx="10" cy="3" r="1.5" fill="currentColor" />
        <circle cx="17" cy="8" r="1.5" fill="currentColor" />
        <circle cx="14" cy="16" r="1.5" fill="currentColor" />
        <circle cx="6" cy="16" r="1.5" fill="currentColor" />
        <circle cx="3" cy="8" r="1.5" fill="currentColor" />
      </svg>
    ),
  },
  {
    mode: 'circle',
    label: 'Circle',
    title: 'Draw a circle – click centre, then click edge (C)',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="10" cy="10" r="1.5" fill="currentColor" />
        <line x1="10" y1="10" x2="17" y2="10" stroke="currentColor" strokeWidth="1" strokeDasharray="2 1" />
      </svg>
    ),
  },
];

export default function ToolBar() {
  const selectionMode = useExplorerStore((s) => s.selectionMode);
  const setSelectionMode = useExplorerStore((s) => s.setSelectionMode);
  const clearSelection = useExplorerStore((s) => s.clearSelection);
  const activeSelection = useExplorerStore((s) => s.activeSelection);
  const selectionInProgress = useExplorerStore((s) => s.selectionInProgress);

  const toggleMode = (mode: SelectionMode) => {
    setSelectionMode(selectionMode === mode ? 'none' : mode);
  };

  // Keyboard shortcuts
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      if (e.key === 'p' || e.key === 'P') toggleMode('point');
      if (e.key === 'r' || e.key === 'R') toggleMode('rectangle');
      if (e.key === 'g' || e.key === 'G') toggleMode('polygon');
      if (e.key === 'c' || e.key === 'C') toggleMode('circle');
      if (e.key === 'Escape') {
        setSelectionMode('none');
        clearSelection();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionMode]);

  return (
    <aside className={styles.toolbar} aria-label="Selection tools">
      <div className={styles.group}>
        {TOOLS.map((tool) => (
          <button
            key={tool.mode}
            className={`${styles.btn} ${selectionMode === tool.mode ? styles.active : ''}`}
            onClick={() => toggleMode(tool.mode)}
            title={tool.title}
            aria-pressed={selectionMode === tool.mode}
            aria-label={tool.label}
          >
            {tool.icon}
            <span className={styles.label}>{tool.label}</span>
          </button>
        ))}
      </div>

      {/* Divider */}
      <div className={styles.divider} aria-hidden="true" />

      {/* Clear */}
      <div className={styles.group}>
        <button
          className={styles.btn}
          onClick={() => {
            setSelectionMode('none');
            clearSelection();
          }}
          title="Clear selection (Esc)"
          aria-label="Clear selection"
          disabled={!activeSelection && selectionInProgress.length === 0}
        >
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <line x1="5" y1="5" x2="15" y2="15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="15" y1="5" x2="5" y2="15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span className={styles.label}>Clear</span>
        </button>
      </div>

      {/* In-progress indicator */}
      {selectionInProgress.length > 0 && (
        <div className={styles.progressBadge} aria-live="polite">
          {selectionMode === 'polygon'
            ? `${selectionInProgress.length} pts`
            : selectionMode === 'rectangle' || selectionMode === 'circle'
            ? 'Click 2nd pt'
            : ''}
        </div>
      )}
    </aside>
  );
}
