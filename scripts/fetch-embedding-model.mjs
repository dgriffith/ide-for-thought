/**
 * Fetch the bundled local embedding model (#834) into `resources/models/`.
 *
 * The semantic-search subsystem embeds note text with all-MiniLM-L6-v2 running
 * fully offline at RUNTIME — but the ~23 MB weights shouldn't bloat the git repo
 * (no LFS here). So we fetch them at dev/build time into a gitignored dir that
 * forge ships via `extraResource: ['resources']`. Idempotent: files already
 * present at the right size are skipped, so this is a no-op on warm trees and
 * adds no network cost to a normal `pnpm dev`.
 *
 * Build-time network is fine — the *app* is offline, not the build. CI fetches
 * once; the packaged app carries the weights and never phones home.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const DEST = path.join(ROOT, 'resources', 'models', 'all-MiniLM-L6-v2');

// The exact files the WASM embedder loads: the quantized ONNX graph + the
// tokenizer trio. Sizes are the known-good byte counts so a truncated/partial
// download is re-fetched rather than trusted.
const FILES = [
  { rel: 'onnx/model_quantized.onnx', minBytes: 22_000_000 },
  { rel: 'tokenizer.json', minBytes: 600_000 },
  { rel: 'tokenizer_config.json', minBytes: 100 },
  { rel: 'config.json', minBytes: 100 },
];

const BASE = `https://huggingface.co/${MODEL_ID}/resolve/main`;

// Prefer the copy transformers.js may have already cached during install/use —
// no network needed when it's there.
const NPM_CACHE = path.join(
  ROOT, 'node_modules', '@huggingface', 'transformers', '.cache', MODEL_ID,
);

async function ensureFile(rel, minBytes) {
  const dest = path.join(DEST, rel);
  if (fs.existsSync(dest) && fs.statSync(dest).size >= minBytes) return 'present';

  fs.mkdirSync(path.dirname(dest), { recursive: true });

  const cached = path.join(NPM_CACHE, rel);
  if (fs.existsSync(cached) && fs.statSync(cached).size >= minBytes) {
    fs.copyFileSync(cached, dest);
    return 'copied';
  }

  const url = `${BASE}/${rel}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < minBytes) throw new Error(`${rel} truncated: ${buf.length} < ${minBytes}`);
  fs.writeFileSync(dest, buf);
  return 'downloaded';
}

let downloaded = 0;
for (const f of FILES) {
  const how = await ensureFile(f.rel, f.minBytes);
  if (how !== 'present') downloaded++;
  console.log(`  ${how.padEnd(10)} ${f.rel}`);
}
console.log(downloaded === 0
  ? 'embedding model already present — nothing to do'
  : `embedding model ready in resources/models/all-MiniLM-L6-v2 (${downloaded} file(s) fetched)`);
