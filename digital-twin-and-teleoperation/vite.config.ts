import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // A teleoperation session must never be reloaded underneath the operator:
      // new builds are announced through PWABadge and applied on confirmation.
      registerType: 'prompt',
      injectRegister: null,
      includeAssets: ['favicon.svg', 'icons/*.svg', 'robots.txt', 'sitemap.xml'],
      manifest: {
        name: 'ROS 2 Digital Twin & Teleoperation',
        short_name: 'ROS 2 Twin',
        description:
          'Browser-based ROS 2 digital twin and teleoperation workspace: URDF viewer and editor, live joint telemetry, jog teaching, motion recording and playback, WebRTC/WHEP video and E-Stop safety.',
        lang: 'en',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        display_override: ['standalone', 'minimal-ui', 'browser'],
        orientation: 'any',
        background_color: '#0b1220',
        theme_color: '#0b1220',
        categories: ['developer tools', 'productivity', 'science'],
        icons: [
          { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: '/icons/icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
        screenshots: [
          {
            src: '/screenshots/desktop.png',
            sizes: '1280x720',
            type: 'image/png',
            form_factor: 'wide',
            label: 'Digital twin workspace: URDF view, telemetry and jog controls',
          },
          {
            src: '/screenshots/urdf-editor.png',
            sizes: '1280x720',
            type: 'image/png',
            form_factor: 'wide',
            label: 'In-browser URDF editor with live 3D preview',
          },
        ],
      },
      workbox: {
        // Precache the app shell only: URDF/mesh assets are user supplied and
        // may be large, so they are deliberately left out of the precache.
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        globIgnores: ['**/assets/*.urdf'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        runtimeCaching: [
          {
            // Monaco is served from a CDN by default; caching it keeps the
            // URDF editor usable offline after the first visit.
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'monaco-cdn',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Static same-origin assets; navigation requests are excluded so a
            // stale index.html can never shadow a freshly deployed build.
            urlPattern: ({ sameOrigin, request }) =>
              sameOrigin && ['script', 'style', 'font', 'image', 'worker'].includes(request.destination),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'app-static',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 14 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  build: {
    rollupOptions: {
      output: {
        // Split the heavy 3D / charting vendors so the app shell stays small
        // and the browser can cache them independently.
        manualChunks: {
          three: ['three', 'urdf-loader'],
          echarts: ['echarts'],
          ros: ['roslib'],
        },
      },
    },
    chunkSizeWarningLimit: 1200,
  },
});
