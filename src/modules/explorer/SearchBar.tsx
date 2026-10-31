/**
 * SearchBar – floating geographic search with Nominatim geocoding.
 * Accepts place names and raw coordinate pairs (lat/lng or lng/lat).
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useExplorerStore } from '@/store';
import { searchLocations, tryParseCoordinates, formatCoordinates } from '@/utils';
import type { SearchResult } from '@/types';
import styles from './SearchBar.module.css';

// Simple debounce hook
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debouncedValue;
}

export default function SearchBar() {
  const setCamera = useExplorerStore((s) => s.setCamera);
  const viewMode = useExplorerStore((s) => s.viewMode);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const debouncedQuery = useDebounce(query, 400);

  // Search whenever debounced query changes
  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }

    // Try coordinate parse first
    const coords = tryParseCoordinates(debouncedQuery);
    if (coords) {
      setResults([
        {
          id: 'coord',
          name: formatCoordinates(coords),
          displayName: formatCoordinates(coords),
          type: 'coordinates',
          lngLat: coords,
        },
      ]);
      setOpen(true);
      return;
    }

    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    setError(null);

    searchLocations(debouncedQuery)
      .then((res) => {
        setResults(res);
        setOpen(res.length > 0);
        setSelectedIdx(-1);
      })
      .catch((e) => {
        if (e.name !== 'AbortError') {
          setError('Search failed. Check your connection.');
        }
      })
      .finally(() => setLoading(false));
  }, [debouncedQuery]);

  const flyTo = useCallback(
    (result: SearchResult) => {
      if (result.bbox) {
        // Calculate centre of bbox
        const [west, south, east, north] = result.bbox;
        const lng = (west + east) / 2;
        const lat = (south + north) / 2;
        // Estimate zoom from bbox size
        const latSpan = north - south;
        const altitude = Math.max(10_000, latSpan * 111_000 * 3); // rough metres
        setCamera({ longitude: lng, latitude: lat, altitude });
      } else {
        setCamera({
          longitude: result.lngLat[0],
          latitude: result.lngLat[1],
          altitude: 500_000,
        });
      }
      setQuery(result.name);
      setOpen(false);
    },
    [setCamera]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && selectedIdx >= 0) {
      e.preventDefault();
      flyTo(results[selectedIdx]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const iconForType = (type: SearchResult['type']) => {
    switch (type) {
      case 'city': return '🏙';
      case 'region': return '🗺';
      case 'country': return '🌍';
      case 'coordinates': return '📍';
      default: return '📌';
    }
  };

  return (
    <div className={styles.container} role="search">
      <div className={styles.inputWrapper}>
        <svg
          className={styles.searchIcon}
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden="true"
        >
          <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.5" />
          <line x1="13" y1="13" x2="17" y2="17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>

        <input
          ref={inputRef}
          className={styles.input}
          type="search"
          placeholder="Search places or enter coordinates…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => results.length > 0 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
          aria-label="Geographic search"
          aria-autocomplete="list"
          aria-controls="search-results"
          aria-expanded={open}
          autoComplete="off"
          spellCheck={false}
        />

        {loading && (
          <div className={styles.spinner} aria-hidden="true" />
        )}

        {query && !loading && (
          <button
            className={styles.clearBtn}
            onClick={() => {
              setQuery('');
              setResults([]);
              setOpen(false);
              inputRef.current?.focus();
            }}
            aria-label="Clear search"
          >
            ✕
          </button>
        )}
      </div>

      {error && <p className={styles.error}>{error}</p>}

      {open && results.length > 0 && (
        <ul
          id="search-results"
          ref={listRef}
          className={styles.results}
          role="listbox"
          aria-label="Search results"
        >
          {results.map((r, i) => (
            <li
              key={r.id}
              className={`${styles.result} ${i === selectedIdx ? styles.selected : ''}`}
              role="option"
              aria-selected={i === selectedIdx}
              onMouseDown={() => flyTo(r)}
            >
              <span className={styles.resultIcon} aria-hidden="true">
                {iconForType(r.type)}
              </span>
              <span className={styles.resultName}>{r.name}</span>
              <span className={styles.resultDetail}>{r.displayName}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
