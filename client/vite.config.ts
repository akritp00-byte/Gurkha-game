import { defineConfig } from 'vite';

export default defineConfig({
  // One .env at the repo root serves client and server. Vite only exposes VITE_* variables to the browser.
  envDir: '..',
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  // Three.js alone is ~530 kB minified (~135 kB gzipped); warn only on real bloat beyond that.
  // The binding budget is BUILD_PROMPT.md §6: under 15 MB initial download.
  build: { chunkSizeWarningLimit: 1000 },
  // Pre-bundle Three.js and the add-ons we use at startup, so the dev server never has to
  // re-optimise (and reload the page) when it first meets one of them.
  optimizeDeps: { include: ['three', 'three/addons/utils/BufferGeometryUtils.js'] },
});
