/**
 * Bundles www/app.js (and everything it imports from /engine, /core, /data,
 * /storage) into www/bundle.js.
 *
 * WHY THIS EXISTS: Capacitor copies only `webDir` (www/) into the APK. Modules
 * living outside www/ are NOT shipped, so a raw <script type="module"> that
 * imports ../core/... resolves to nothing on device. Bundling inlines them.
 *
 * Run: node scripts/buildWeb.js   (or npm run build:web)
 */

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

await build({
  entryPoints: [resolve(root, 'www/app.js')],
  outfile: resolve(root, 'www/bundle.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  sourcemap: true,
  // Stockfish is loaded as a separate Worker from www/vendor/, never bundled.
  external: ['./vendor/stockfish/stockfish.js'],
  logLevel: 'info',
});

console.log('Built www/bundle.js');


