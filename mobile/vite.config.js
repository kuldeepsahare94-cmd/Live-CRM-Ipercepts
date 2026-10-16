import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// The app's screens are plain files inside the phone (Capacitor): relative paths.
export default defineConfig({
  plugins: [react()],
  base: './',
  // (v1.4) phone alerts are built in only when the build has the Firebase file (GitHub secret
  // ICRM_GOOGLE_SERVICES_JSON): without it, Android would close the app when alerts start
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __PUSH__: JSON.stringify(process.env.ICRM_PUSH === '1') },
  build: { outDir: 'dist', target: 'es2020', chunkSizeWarningLimit: 900 },
  server: { port: 5175, host: true },
  preview: { port: 5175, host: true },
});
