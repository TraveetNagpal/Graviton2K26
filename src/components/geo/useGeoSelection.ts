/**
 * useGeoSelection – convenience hook that exposes selection state and helpers
 * for use outside the Explorer module (e.g. in analysis forms).
 *
 * Returns the current GeoJSON selection with its CRS set to WGS 84, ready to
 * send to the TerraMind backend API.
 */

import { useExplorerStore } from '@/store';
import type { GeoJSONSelection, SelectionMode } from '@/types';

export interface UseGeoSelectionReturn {
  /** Current active selection (null if nothing selected) */
  selection: GeoJSONSelection | null;
  /** The active drawing mode */
  selectionMode: SelectionMode;
  /** Switch drawing mode */
  setSelectionMode: (mode: SelectionMode) => void;
  /** Programmatically set a selection */
  setSelection: (sel: GeoJSONSelection | null) => void;
  /** Clear the current selection and stop drawing */
  clearSelection: () => void;
  /** True while the user is mid-way through drawing */
  isDrawing: boolean;
  /** Number of vertices recorded so far (relevant for polygon mode) */
  vertexCount: number;
}

export function useGeoSelection(): UseGeoSelectionReturn {
  const selection = useExplorerStore((s) => s.activeSelection);
  const selectionMode = useExplorerStore((s) => s.selectionMode);
  const selectionInProgress = useExplorerStore((s) => s.selectionInProgress);
  const setSelectionMode = useExplorerStore((s) => s.setSelectionMode);
  const setActiveSelection = useExplorerStore((s) => s.setActiveSelection);
  const clearSelection = useExplorerStore((s) => s.clearSelection);

  return {
    selection,
    selectionMode,
    setSelectionMode,
    setSelection: setActiveSelection,
    clearSelection,
    isDrawing: selectionMode !== 'none' && selectionInProgress.length > 0,
    vertexCount: selectionInProgress.length,
  };
}
