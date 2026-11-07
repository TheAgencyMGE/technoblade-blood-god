import { defineConfig } from 'vite';

// Relative base so the same build runs at a domain root, under a GitHub Pages subpath, or inside the desktop app.
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 1200 },
});
