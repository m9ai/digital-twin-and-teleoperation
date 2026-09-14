import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
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
