// Builds the npm library into dist/ (the Next.js demo app is not included)
import { copyFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'copy-styles',
      closeBundle() {
        copyFileSync('src/react-beauti-graph.css', 'dist/style.css');
      },
    },
  ],
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    lib: {
      entry: 'src/index.js',
      formats: ['es', 'cjs'],
      fileName: (format) => (format === 'es' ? 'index.js' : 'index.cjs'),
    },
    rollupOptions: {
      // Installed by the app using the library, not bundled
      external: [/^react($|\/)/, /^react-dom($|\/)/, /^cytoscape($|\/)/],
      output: {
        // Lets Next.js (App Router) use the component directly
        banner: "'use client';",
      },
    },
  },
});
