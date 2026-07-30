// Build step for the sample pipeline: copies src/calc.js into dist/ and
// writes dist/build-info.json (build time + node version), which the
// server exposes on its info endpoint.
import { mkdirSync, copyFileSync, writeFileSync } from 'node:fs';

mkdirSync('dist', { recursive: true });
copyFileSync('src/calc.js', 'dist/calc.js');
writeFileSync('dist/build-info.json', JSON.stringify({
  builtAt: new Date().toISOString(),
  node: process.version,
}, null, 2));
console.log('build: wrote dist/calc.js and dist/build-info.json');
