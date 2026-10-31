/**
 * AppShell – top-level layout wrapper.
 * Houses the nav bar and the main content slot.
 * Module 1 (Dashboard) can be integrated here without touching the Explorer.
 */

import React from 'react';
import { NavLink } from 'react-router-dom';
import styles from './AppShell.module.css';

interface AppShellProps {
  children: React.ReactNode;
}

export default function AppShell({ children }: AppShellProps) {
  return (
    <div className={styles.shell}>
      <header className={styles.header} role="banner">
        <div className={styles.brand}>
          <svg
            className={styles.logo}
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
            <ellipse
              cx="12"
              cy="12"
              rx="5"
              ry="10"
              stroke="currentColor"
              strokeWidth="1"
            />
            <line x1="2" y1="12" x2="22" y2="12" stroke="currentColor" strokeWidth="1" />
            <line x1="3.5" y1="7.5" x2="20.5" y2="7.5" stroke="currentColor" strokeWidth="0.8" opacity="0.5" />
            <line x1="3.5" y1="16.5" x2="20.5" y2="16.5" stroke="currentColor" strokeWidth="0.8" opacity="0.5" />
          </svg>
          <span className={styles.brandName}>TerraMind AI</span>
        </div>

        <nav className={styles.nav} aria-label="Main navigation">
          <NavLink
            to="/dashboard"
            className={({ isActive }) =>
              `${styles.navLink} ${isActive ? styles.active : ''}`
            }
          >
            Dashboard
          </NavLink>
          <NavLink
            to="/explorer"
            className={({ isActive }) =>
              `${styles.navLink} ${isActive ? styles.active : ''}`
            }
          >
            Earth Explorer
          </NavLink>
          <NavLink to="/reports" className={({ isActive }) => `${styles.navLink} ${isActive ? styles.active : ''}`}>
            Reports
          </NavLink>
        </nav>
      </header>

      <main className={styles.main} role="main">
        {children}
      </main>
    </div>
  );
}
