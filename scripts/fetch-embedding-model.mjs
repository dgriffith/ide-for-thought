/**
 * Fetch the bundled local embedding model (#834) into `resources/models/`.
 *
 * The semantic-search subsystem embeds note text with all-MiniLM-L6-v2 running
 * fully offline at RUNTIME — but the ~23 MB weights shouldn't bloat the git repo
 * (no LFS here). So we fetch them at dev/build time into a gitignored dir that
 * forge ships via `extraResource: ['resources']`. Idempotent: files already
 * present with the right SHA-256 are skipped, so this is a no-op on warm trees
 * and adds no network cost to a normal `pnpm dev`.
 *
 * Build-time network is fine — the *app* is offline, not the build. CI fetches
 * once; the packaged app carries the weights and never phones home.
 *
 * Integrity (#1489 / A08). Two pins, both load-bearing:
 *   1. `REVISION` — an immutable HF commit SHA, NOT the moving `main` branch, so
 *      a future upstream force-push / retag can't change what we fetch.
 *   2. `sha256` per file — the exact bytes are verified on every path (already
 *      present, copied from the transformers.js cache, or freshly downloaded).
 *      A mismatch on a fresh download THROWS, failing the build rather than
 *      shipping (or silently trusting) tampered/MITM'd weights. A stale/corrupt
 *      already-present or cached file simply fails the check and is re-fetched.
 *
 * To bump the model: pick the new HF commit SHA, download each file at that
 * revision, and update `REVISION` + every `sha256` below in the same commit.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const DEST = path.join(ROOT, 'resources', 'models', 'all-MiniLM-L6-v2');

// Immutable pin — the HF commit these hashes were taken from. Never `main`.
export const REVISION = '751bff37182d3f1213fa05d7196b954e230abad9';

// The exact files the WASM embedder loads: the quantized ONNX graph + the
// tokenizer trio, each pinned to its known-good SHA-256. The hash subsumes the
// old byte-count check — a truncated or altered file can't match it.
export const FILES = [
  { rel: 'onnx/model_quantized.onnx', sha256: 'afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1' },
  { rel: 'tokenizer.json', sha256: 'da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0' },
  { rel: 'tokenizer_config.json', sha256: '9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3' },
  { rel: 'config.json', sha256: '7135149f7cffa1a573466c6e4d8423ed73b62fd2332c575bf738a0d033f70df7' },
];

const BASE = `https://huggingface.co/${MODEL_ID}/resolve/${REVISION}`;

// Prefer the copy transformers.js may have already cached during install/use —
// no network needed when it's there (and it's hash-verified all the same).
const NPM_CACHE = path.join(
  ROOT, 'node_modules', '@huggingface', 'transformers', '.cache', MODEL_ID,
);

export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** True iff `p` exists and its bytes hash to `expectedSha`. */
export function fileHasSha(p, expectedSha) {
  if (!fs.existsSync(p)) return false;
  return sha256(fs.readFileSync(p)) === expectedSha;
}

async function ensureFile(rel, expectedSha) {
  const dest = path.join(DEST, rel);
  if (fileHasSha(dest, expectedSha)) return 'present';

  fs.mkdirSync(path.dirname(dest), { recursive: true });

  const cached = path.join(NPM_CACHE, rel);
  if (fileHasSha(cached, expectedSha)) {
    fs.copyFileSync(cached, dest);
    return 'copied';
  }

  const url = `${BASE}/${rel}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const got = sha256(buf);
  if (got !== expectedSha) {
    throw new Error(
      `${rel} integrity check failed: sha256 ${got} != pinned ${expectedSha} ` +
      `(revision ${REVISION}). Refusing to write — upstream bytes changed or the download was tampered.`,
    );
  }
  fs.writeFileSync(dest, buf);
  return 'downloaded';
}

export async function fetchEmbeddingModel() {
  let downloaded = 0;
  for (const f of FILES) {
    const how = await ensureFile(f.rel, f.sha256);
    if (how !== 'present') downloaded++;
    console.log(`  ${how.padEnd(10)} ${f.rel}`);
  }
  console.log(downloaded === 0
    ? 'embedding model already present — nothing to do'
    : `embedding model ready in resources/models/all-MiniLM-L6-v2 (${downloaded} file(s) fetched)`);
  return downloaded;
}

// Run only when invoked as a script (`node scripts/fetch-embedding-model.mjs`),
// not when imported by a test.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await fetchEmbeddingModel();
}
