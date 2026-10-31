/**
 * Dashboard – Module 1 placeholder.
 * Replace this file with the full Dashboard implementation.
 * The AppShell and routing are already wired; no changes needed there.
 */

import React from 'react';

export default function Dashboard() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        gap: 12,
        color: 'var(--color-text-muted)',
      }}
    >
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="3" y="3" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.5" />
        <rect x="13" y="3" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.5" />
        <rect x="3" y="13" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.5" />
        <rect x="13" y="13" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <p style={{ fontSize: 16, fontWeight: 500 }}>Module 1 – Dashboard</p>
      <p style={{ fontSize: 13 }}>Coming soon. Integrate without rebuilding the Explorer.</p>
    </div>
  );
}
