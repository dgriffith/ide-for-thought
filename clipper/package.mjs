/**
 * Package the built clipper into a single distributable zip (#795).
 * `pnpm package:clipper` rebuilds `dist/` then zips its CONTENTS into
 * `clipper/minerva-clipper-<version>.zip` (version read from the built
 * manifest, so it can't drift from the source).
 *
 * The manifest must sit at the ARCHIVE ROOT — the Chrome Web Store rejects a zip
 * with a wrapping top-level folder — so we zip from inside `dist/` with relative
 * paths. The zip is for handing someone a file / a future Web Store upload;
 * day-to-day "Load unpacked" uses `dist/` directly and doesn't need it.
 */

import { execFileSync } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, 'dist');

// Always rebuild so the zip reflects current sources.
execFileSync('node', [path.join(root, 'build.mjs')], { stdio: 'inherit' });

const { version } = JSON.parse(await readFile(path.join(dist, 'manifest.json'), 'utf-8'));
const zipPath = path.join(root, `minerva-clipper-${version}.zip`);
await rm(zipPath, { force: true });

try {
  // cwd=dist + '.' → manifest.json lands at the zip root. -X drops extra
  // filesystem attributes for a clean, reproducible archive.
  execFileSync('zip', ['-r', '-X', zipPath, '.'], { cwd: dist, stdio: 'inherit' });
} catch (err) {
  throw new Error(
    `[clipper] zip failed — is the \`zip\` CLI available on PATH? (${err instanceof Error ? err.message : String(err)})`,
  );
}

console.log('Minerva Clipper packaged →', path.relative(process.cwd(), zipPath));
