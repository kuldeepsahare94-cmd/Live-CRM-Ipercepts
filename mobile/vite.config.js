import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The app's screens are plain files inside the phone (Capacitor): relative paths.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist', target: 'es2020', chunkSizeWarningLimit: 900 },
  server: { port: 5175, host: true },
  preview: { port: 5175, host: true },
});
