/**
 * Build the precomputed help-docs corpus (#1284, epic:docs-grounding, #1154).
 *
 * Embeds `website/docs/*.html` (extracted into chunks by
 * `scripts/lib/extract-docs-corpus.mjs`) with the same bundled all-MiniLM-L6-v2
 * model the thoughtbase's own semantic search uses, and writes the result to
 * `resources/help-docs/corpus.json` — a static asset shipped alongside the app
 * (via forge's `extraResource: ['resources']`), not rebuilt at runtime. The
 * docs corpus is the same for every user and every project, so unlike the
 * per-project note embeddings it's computed once here, at dev/build time, the
 * same way `fetch-embedding-model.mjs` stages the model weights themselves.
 *
 * This script imports `wasm-embedder.ts` directly, which has its own
 * extensionless relative imports (`from './pooling'`, etc.) — plain Node's
 * loader doesn't resolve those (only a bundler/dev-server's resolution does),
 * so this must run through `vite-node` (already present as a transitive
 * dependency of vitest — no new devDependency needed), not plain `node`.
 * Hence the `fetch:help-corpus`/`predev`/`prebuild*` wiring in package.json
 * invokes `vite-node scripts/build-help-corpus.mjs`, mirroring how
 * `fetch-embedding-model.mjs` is invoked with plain `node` (it has no such
 * import, so it doesn't need this).
 *
 * Idempotent, like `fetch-embedding-model.mjs`: re-embedding ~500 chunks
 * through the WASM model takes real time (~20s), and `predev` runs on every
 * `pnpm dev` restart — so skip the rebuild when `corpus.json` is already
 * newer than every input that could change its content (the docs pages
 * themselves, the extraction logic, and this script), and was built against
 * the model this checkout ships (#1284).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractDocsCorpus } from './lib/extract-docs-corpus.mjs';
import { createWasmEmbedder } from '../src/main/embeddings/wasm-embedder.ts';
import { MODEL } from '../src/main/embeddings/embedder.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS_DIR = path.join(ROOT, 'website', 'docs');
const OUT_DIR = path.join(ROOT, 'resources', 'help-docs');
const OUT_FILE = path.join(OUT_DIR, 'corpus.json');
const THIS_FILE = fileURLToPath(import.meta.url);
const EXTRACT_FILE = path.join(ROOT, 'scripts', 'lib', 'extract-docs-corpus.mjs');

function latestMtimeMs(dir) {
  let latest = 0;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.html')) continue;
    latest = Math.max(latest, fs.statSync(path.join(dir, name)).mtimeMs);
  }
  return latest;
}

function isUpToDate() {
  if (!fs.existsSync(OUT_FILE)) return false;
  let existing;
  try {
    existing = JSON.parse(fs.readFileSync(OUT_FILE, 'utf-8'));
  } catch {
    return false;
  }
  if (existing.model !== MODEL.name || existing.dim !== MODEL.dim) return false;

  const outMtime = fs.statSync(OUT_FILE).mtimeMs;
  const inputsMtime = Math.max(
    latestMtimeMs(DOCS_DIR),
    fs.statSync(EXTRACT_FILE).mtimeMs,
    fs.statSync(THIS_FILE).mtimeMs,
  );
  return outMtime >= inputsMtime;
}

if (isUpToDate()) {
  console.log('help-docs corpus is up to date — skipping rebuild (resources/help-docs/corpus.json)');
  process.exit(0);
}

const chunks = extractDocsCorpus(DOCS_DIR);
if (chunks.length === 0) {
  throw new Error(`no chunks extracted from ${DOCS_DIR} — is website/docs/ present?`);
}

const embedder = await createWasmEmbedder({ resourcesBase: path.join(ROOT, 'resources') });
try {
  const vectors = await embedder.embed(chunks.map((c) => c.text));
  const corpus = {
    model: MODEL.name,
    dim: MODEL.dim,
    generatedAt: new Date().toISOString(),
    chunks: chunks.map((c, i) => ({ ...c, vector: Array.from(vectors[i]) })),
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(corpus));

  const sizeKb = Math.round(fs.statSync(OUT_FILE).size / 1024);
  console.log(`help-docs corpus built: ${chunks.length} chunks from website/docs/ → resources/help-docs/corpus.json (${sizeKb} KB)`);
} finally {
  await embedder.dispose();
}
