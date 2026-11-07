// Finishes the type files that `tsc` writes into dist/:
// - relative imports end in .ts/.tsx in the source; the published types must say .js
// - require() users get their own .d.cts copies whose imports end in .cjs
//   (Node's CommonJS resolution needs it)
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const dist = path.resolve(import.meta.dirname, '..', 'dist');
const relativeImport = /(from\s+['"]\.\/[^'"]+)\.tsx?(['"])/g;

for (const file of readdirSync(dist).filter((name) => name.endsWith('.d.ts'))) {
  const esm = readFileSync(path.join(dist, file), 'utf8').replace(relativeImport, '$1.js$2');
  writeFileSync(path.join(dist, file), esm);
  const cjs = esm.replace(/(from\s+['"]\.\/[^'"]+)\.js(['"])/g, '$1.cjs$2');
  writeFileSync(path.join(dist, file.replace(/\.d\.ts$/, '.d.cts')), cjs);
}
