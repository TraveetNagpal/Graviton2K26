import { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import AppShell from './components/layout/AppShell';
import LoadingSpinner from './components/ui/LoadingSpinner';

// Editorial landing page
const Landing = lazy(() => import('./modules/landing/Landing'));

// Module 2 – Interactive Earth Explorer (lazy-loaded for code splitting)
const EarthExplorer = lazy(() => import('./modules/explorer/EarthExplorer'));

// Dashboard overview
const Dashboard = lazy(() => import('./modules/dashboard/Dashboard'));
const Reports = lazy(() => import('./modules/reports/Reports'));

export default function App() {
  return (
    <AppShell>
      <Suspense fallback={<LoadingSpinner message="Loading module…" />}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/explorer" element={<EarthExplorer />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
}
