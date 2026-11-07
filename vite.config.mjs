// Demo app in examples/ (npm run dev / build / start). The npm library is built by vite.lib.config.mjs
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'examples',
  plugins: [react()],
  build: { outDir: '../dist-demo', emptyOutDir: true },
});
