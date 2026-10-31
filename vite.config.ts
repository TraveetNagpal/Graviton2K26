import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import cesium from 'vite-plugin-cesium';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    cesium(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  define: {
    // Silence CesiumJS CESIUM_BASE_URL warning when using vite-plugin-cesium
    CESIUM_BASE_URL: JSON.stringify('/'),
  },
  optimizeDeps: {
    // Cesium is served as source, so pre-bundle the CommonJS packages it
    // imports; otherwise their default exports break in the browser.
    exclude: ['cesium'],
    include: [
      'autolinker',
      'bitmap-sdf',
      'dompurify',
      'earcut',
      'grapheme-splitter',
      'jsep',
      'kdbush',
      'lerc',
      'mersenne-twister',
      'nosleep.js',
      'pako/lib/inflate.js',
      'rbush',
      'topojson-client',
      'urijs',
    ],
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
      '/docs': 'http://localhost:8000',
      '/openapi.json': 'http://localhost:8000',
      '/redoc': 'http://localhost:8000',
      '/health': 'http://localhost:8000',
      '/ready': 'http://localhost:8000',
    },
  },
  build: {
    chunkSizeWarningLimit: 10000,
    rollupOptions: {
      output: {
        manualChunks: {
          maplibre: ['maplibre-gl'],
          turf: ['@turf/turf'],
        },
      },
    },
  },
});
