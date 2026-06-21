/**
 * Build the Minerva Clipper extension into `clipper/dist/` — a separate target
 * from the Electron app (`pnpm build:clipper`). esbuild bundles the TS entry
 * points; the manifest + options page are copied alongside. Load `dist/` as an
 * unpacked extension (chrome://extensions → Load unpacked).
 */

import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(root, 'dist');

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

await build({
  entryPoints: {
    background: path.join(root, 'src/background.ts'),
    options: path.join(root, 'src/options.ts'),
    popup: path.join(root, 'src/popup.ts'),
  },
  bundle: true,
  format: 'esm',
  target: 'chrome114',
  outdir: out,
  logLevel: 'info',
});

await cp(path.join(root, 'manifest.json'), path.join(out, 'manifest.json'));
await cp(path.join(root, 'options.html'), path.join(out, 'options.html'));
await cp(path.join(root, 'popup.html'), path.join(out, 'popup.html'));
await cp(path.join(root, 'icons'), path.join(out, 'icons'), { recursive: true });

console.log('Minerva Clipper built →', path.relative(process.cwd(), out));
