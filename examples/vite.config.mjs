// Example app (run from this folder: npm install, npm run dev).
// The app imports the package 'react-beauti-graph'. Two ways to get it:
// - inside the library repository, the name points at the library source in ../src, so changes to
//   the library show up at once (to try the built package instead, run `npm run build:lib` in the
//   repository root and remove the alias);
// - on its own (for example opened in StackBlitz, or copied out of the repository), there is no ../src,
//   so the package installed from npm is used.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const lib = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
const useLibrarySource = existsSync(path.join(lib, 'index.ts'));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: useLibrarySource
      ? [
          { find: 'react-beauti-graph/style.css', replacement: path.join(lib, 'react-beauti-graph.css') },
          { find: /^react-beauti-graph$/, replacement: path.join(lib, 'index.ts') },
        ]
      : [],
    // One copy of React: the library must use the one installed here
    dedupe: ['react', 'react-dom'],
  },
  server: { fs: { allow: useLibrarySource ? ['..'] : [] } },
  build: { outDir: 'dist', emptyOutDir: true },
});
