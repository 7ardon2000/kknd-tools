import { defineConfig } from 'vite';

export default defineConfig({
  // relative asset paths so the built folder works from any location (wallpaper engines, file servers)
  base: './',
  server: { port: 5180 },
  build: { outDir: 'dist', assetsDir: 'js', assetsInlineLimit: 0, chunkSizeWarningLimit: 2000 },
});
