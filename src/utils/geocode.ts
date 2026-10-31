/**
 * Geocoding utilities using the Nominatim API (OpenStreetMap).
 * Free, no API key required for reasonable usage.
 * Rate-limit: max 1 request/second per Nominatim ToS.
 */

import type { SearchResult } from '@/types';

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';

const HEADERS = {
  'Accept-Language': 'en',
  // Nominatim requires a meaningful User-Agent per their usage policy
  'User-Agent': 'TerraMindAI/0.1 (contact@terramind.ai)',
};

export interface NominatimFeature {
  place_id: number;
  osm_type: string;
  osm_id: number;
  display_name: string;
  name: string;
  type: string;
  class: string;
  lat: string;
  lon: string;
  boundingbox: [string, string, string, string]; // [south, north, west, east]
}

function classifyType(feature: NominatimFeature): SearchResult['type'] {
  const cls = feature.class;
  const type = feature.type;
  if (cls === 'place') {
    if (['city', 'town', 'village', 'municipality'].includes(type)) return 'city';
    if (['country', 'state', 'region', 'county'].includes(type)) return 'region';
    if (type === 'country') return 'country';
  }
  return 'feature';
}

export async function searchLocations(query: string, limit = 7): Promise<SearchResult[]> {
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    limit: String(limit),
    addressdetails: '0',
    extratags: '0',
  });

  const res = await fetch(`${NOMINATIM_BASE}/search?${params}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`Nominatim error: ${res.status}`);

  const data: NominatimFeature[] = await res.json();

  return data.map((f): SearchResult => {
    const bb = f.boundingbox; // [south, north, west, east]
    return {
      id: `${f.osm_type}-${f.osm_id}`,
      name: f.name || f.display_name,
      displayName: f.display_name,
      type: classifyType(f),
      lngLat: [parseFloat(f.lon), parseFloat(f.lat)],
      bbox: bb
        ? [parseFloat(bb[2]), parseFloat(bb[0]), parseFloat(bb[3]), parseFloat(bb[1])]
        : undefined,
    };
  });
}

export async function reverseGeocode(
  lng: number,
  lat: number
): Promise<string | null> {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lng),
    format: 'json',
    zoom: '12',
    addressdetails: '0',
  });

  const res = await fetch(`${NOMINATIM_BASE}/reverse?${params}`, { headers: HEADERS });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.display_name ?? null;
}
