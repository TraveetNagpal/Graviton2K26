/**
 * AppShell – top-level layout wrapper.
 * Editorial masthead navigation above the module content.
 */

import React, { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import styles from './AppShell.module.css';

interface AppShellProps {
  children: React.ReactNode;
}

const NAV_ITEMS = [
  { to: '/', label: 'Home', end: true },
  { to: '/explorer', label: 'Explorer' },
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/reports', label: 'Reports' },
];

function useUtcClock(): string {
  const [time, setTime] = useState(() => new Date().toISOString().slice(11, 19));

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTime(new Date().toISOString().slice(11, 19));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  return time;
}

export default function AppShell({ children }: AppShellProps) {
  const clock = useUtcClock();

  return (
    <div className={styles.shell}>
      <header className={styles.header} role="banner">
        <NavLink to="/" end className={styles.brand} aria-label="TerraMind AI — home">
          <svg
            className={styles.logo}
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1" />
            <ellipse cx="12" cy="12" rx="5" ry="10" stroke="currentColor" strokeWidth="0.7" opacity="0.7" />
            <line x1="2" y1="12" x2="22" y2="12" stroke="currentColor" strokeWidth="0.7" opacity="0.7" />
            <line x1="3.5" y1="7.5" x2="20.5" y2="7.5" stroke="currentColor" strokeWidth="0.5" opacity="0.4" />
            <line x1="3.5" y1="16.5" x2="20.5" y2="16.5" stroke="currentColor" strokeWidth="0.5" opacity="0.4" />
          </svg>
          <span className={styles.brandName}>
            TerraMind<span className={styles.brandSuffix}>AI</span>
          </span>
        </NavLink>

        <nav className={styles.nav} aria-label="Main navigation">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `${styles.navLink} ${isActive ? styles.active : ''}`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className={styles.meta} aria-hidden="true">
          <span className={styles.live}>
            <i className={styles.liveDot} />
            Live
          </span>
          <span className={styles.clock}>{clock} UTC</span>
        </div>
      </header>

      <main className={styles.main} role="main">
        {children}
      </main>
    </div>
  );
}
