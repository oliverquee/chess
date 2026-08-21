import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'artifacts/browser-preview');
await mkdir(output, { recursive: true });
const html = (await readFile(resolve(root, 'www/index.html'), 'utf8'))
  .replace('<script type="module" src="bundle.js"></script>', '<script type="module" src="preview-bundle.js"></script>');
await Promise.all([
  writeFile(resolve(output, 'index.html'), html),
  writeFile(resolve(output, 'index.css'), await readFile(resolve(root, 'www/index.css'))),
]);
await build({
  entryPoints: [resolve(root, 'scripts/browserPreviewEntry.js')],
  outfile: resolve(output, 'preview-bundle.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  logLevel: 'info',
});
process.stdout.write(`Built dev-only preview at ${output}\n`);
