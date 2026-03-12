import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: __dirname,
  publicDir: resolve(__dirname, '..'),
  server: {
    port: 5173,
  },
});
