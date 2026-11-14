// Builds the npm library code into dist/. The types are added by `npm run build:lib` (tsc + scripts/make-cts.mjs).
import { readFileSync, writeFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'copy-styles',
      // dist/style.css = the library styles, with the base styles React Flow needs put in place
      // of the @import that the source css uses (so the example app can load it directly)
      closeBundle() {
        const flowBase = readFileSync('node_modules/@xyflow/react/dist/base.css', 'utf8');
        const own = readFileSync('src/react-beauti-graph.css', 'utf8');
        writeFileSync(
          'dist/style.css',
          own.replace("@import '@xyflow/react/dist/base.css';", () => flowBase)
        );
      },
    },
  ],
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    lib: {
      entry: 'src/index.ts',
      formats: ['es', 'cjs'],
      fileName: (format) => (format === 'es' ? 'index.js' : 'index.cjs'),
    },
    rolldownOptions: {
      // Installed by the app using the library, not bundled
      external: [/^react($|\/)/, /^react-dom($|\/)/, /^@xyflow\/react($|\/)/],
      output: {
        // Lets Next.js (App Router) use the component directly
        banner: "'use client';",
      },
    },
  },
});
