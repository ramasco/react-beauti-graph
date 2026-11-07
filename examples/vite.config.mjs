// Example app (run from this folder: npm install, npm run dev).
// The app imports the package 'react-beauti-graph'. While developing, the name points at the
// library source in ../src, so changes to the library show up at once. To try the built
// package instead, remove the alias and run `npm run build:lib` in the library root.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const lib = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: 'react-beauti-graph/style.css', replacement: path.join(lib, 'react-beauti-graph.css') },
      { find: /^react-beauti-graph$/, replacement: path.join(lib, 'index.js') },
    ],
    // One copy of React: the library source must use the one installed here
    dedupe: ['react', 'react-dom'],
  },
  server: { fs: { allow: ['..'] } },
  build: { outDir: 'dist', emptyOutDir: true },
});
