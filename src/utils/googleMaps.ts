/**
 * Google Maps raster basemap support.
 *
 * Uses the Maps Tile API session flow (the same approach Cesium's Google 2D
 * provider uses). The API key is a public browser key; restrict it by HTTP
 * referrer in Google Cloud Console.
 */

import type { StyleSpecification } from 'maplibre-gl';

export type GoogleMapType = 'satellite' | 'roadmap' | 'terrain';

export interface GoogleTileSession {
  token: string;
  mapType: GoogleMapType;
  expiresAt: number;
}

const API_KEY = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? '').trim();
const MAP_TYPE = (import.meta.env.VITE_GOOGLE_MAPS_MAP_TYPE as GoogleMapType) || 'satellite';
const CACHE_PREFIX = 'terramind:google-tile-session:';
const FALLBACK_LIFETIME_MS = 6 * 60 * 60 * 1000;

export function googleMapsEnabled(): boolean {
  return API_KEY.length > 0;
}

function readCachedSession(mapType: GoogleMapType): GoogleTileSession | null {
  try {
    const raw = window.sessionStorage.getItem(`${CACHE_PREFIX}${mapType}`);
    if (!raw) return null;
    const session = JSON.parse(raw) as GoogleTileSession;
    return session.expiresAt > Date.now() + 60_000 ? session : null;
  } catch {
    return null;
  }
}

function parseExpiry(value: unknown): number {
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (typeof value === 'number') {
    const seconds = value > 1e12 ? value : value * 1000;
    if (Number.isFinite(seconds) && seconds > Date.now()) return seconds;
  }
  return Date.now() + FALLBACK_LIFETIME_MS;
}

export async function getGoogleTileSession(mapType: GoogleMapType = MAP_TYPE): Promise<GoogleTileSession | null> {
  if (!API_KEY) return null;

  const cached = readCachedSession(mapType);
  if (cached) return cached;

  try {
    const response = await fetch(`https://tile.googleapis.com/v1/createSession?key=${encodeURIComponent(API_KEY)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mapType, language: 'en-US', region: 'US' }),
    });
    if (!response.ok) throw new Error(`Google Maps Tile API returned ${response.status}`);
    const body = await response.json();
    if (!body?.session) throw new Error('Google Maps Tile API did not return a session token');

    const session: GoogleTileSession = { token: body.session, mapType, expiresAt: parseExpiry(body.expiry) };
    window.sessionStorage.setItem(`${CACHE_PREFIX}${mapType}`, JSON.stringify(session));
    return session;
  } catch (error) {
    console.warn('Google Maps basemap unavailable; using OpenStreetMap tiles.', error);
    return null;
  }
}

export function googleTileUrlTemplate(session: GoogleTileSession): string {
  return `https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=${encodeURIComponent(session.token)}&key=${encodeURIComponent(API_KEY)}`;
}

export const GOOGLE_ATTRIBUTION = '<a href="https://maps.google.com" target="_blank" rel="noreferrer">© Google</a>';

export async function googleRasterStyle(mapType: GoogleMapType = MAP_TYPE): Promise<StyleSpecification | null> {
  const session = await getGoogleTileSession(mapType);
  if (!session) return null;
  return {
    version: 8,
    sources: {
      google: {
        type: 'raster',
        tiles: [googleTileUrlTemplate(session)],
        tileSize: 256,
        attribution: GOOGLE_ATTRIBUTION,
        maxzoom: 22,
      },
    },
    layers: [{ id: 'google-basemap', type: 'raster', source: 'google' }],
  };
}
