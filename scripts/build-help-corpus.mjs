/**
 * Build the precomputed help-docs corpus (#1284, epic:docs-grounding, #1154).
 *
 * Embeds the docs content fragments `website/docs/_content/*.html` (extracted
 * into chunks by `scripts/lib/extract-docs-corpus.mjs` — the same fragments
 * `scripts/build-docs.mjs` renders the site from, #1842) with the same
 * bundled all-MiniLM-L6-v2
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
 * through the WASM model takes real time (~46s on a CI runner), and `predev`
 * runs on every `pnpm dev` restart — so skip the rebuild when the corpus was
 * already built from exactly these inputs (the docs pages themselves, the
 * extraction logic, this script) against the model this checkout ships
 * (#1284).
 *
 * That freshness check is a CONTENT HASH, not an mtime comparison (#2246).
 * mtimes answer the wrong question in the two cases that matter most:
 *
 *   - **A restored CI cache.** `actions/checkout` stamps every source file
 *     with the checkout time, while a restored `resources/help-docs/` keeps
 *     the mtime it had when the cache was written — which is older. An mtime
 *     check therefore rebuilds every time, so caching the directory would
 *     report a hit in the log and save nothing. Measured: touching the inputs
 *     to simulate a checkout made the old check rebuild all 523 chunks.
 *   - **Switching branches.** `git checkout` rewrites the mtime of every file
 *     it touches, so moving between branches cost a full rebuild even when
 *     the docs content was byte-identical.
 *
 * The hash covers the same inputs the old check stat'd, plus the model
 * identity, and is stored in the corpus itself. `.github/workflows/ci.yml`'s
 * cache key hashes the same set, so a cache miss and a rebuild coincide.
 */

import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractDocsCorpus } from './lib/extract-docs-corpus.mjs';
import { CONTENT_DIR } from './lib/docs-model.mjs';
import { createWasmEmbedder } from '../src/main/embeddings/wasm-embedder.ts';
import { MODEL } from '../src/main/embeddings/embedder.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS_DIR = path.join(ROOT, 'website', 'docs');
const OUT_DIR = path.join(ROOT, 'resources', 'help-docs');
const OUT_FILE = path.join(OUT_DIR, 'corpus.json');
const THIS_FILE = fileURLToPath(import.meta.url);
const CONTENT_PATH = path.join(DOCS_DIR, CONTENT_DIR);
const EXTRACT_FILE = path.join(ROOT, 'scripts', 'lib', 'extract-docs-corpus.mjs');
const MODEL_FILE = path.join(ROOT, 'scripts', 'lib', 'docs-model.mjs');

/**
 * A digest of everything that can change the corpus's contents.
 *
 * Filenames go into the hash alongside their bytes, so adding or renaming a
 * docs page invalidates even when the total byte content happens to match.
 * Sorted, so the digest doesn't depend on readdir order across filesystems.
 */
export function inputsHash() {
  const h = crypto.createHash('sha256');
  // Model identity: the vectors are only comparable against the model that
  // produced them, which is why the old check compared these separately.
  h.update(`model:${MODEL.name}:${MODEL.dim}\n`);
  for (const file of [EXTRACT_FILE, MODEL_FILE, THIS_FILE]) {
    h.update(`file:${path.basename(file)}\n`);
    h.update(fs.readFileSync(file));
  }
  for (const name of fs.readdirSync(CONTENT_PATH).filter((n) => n.endsWith('.html')).sort()) {
    h.update(`doc:${name}\n`);
    h.update(fs.readFileSync(path.join(CONTENT_PATH, name)));
  }
  return h.digest('hex');
}

function isUpToDate() {
  if (!fs.existsSync(OUT_FILE)) return false;
  let existing;
  try {
    existing = JSON.parse(fs.readFileSync(OUT_FILE, 'utf-8'));
  } catch {
    return false;
  }
  // A corpus written before #2246 has no `inputsHash`, so it rebuilds once
  // and is stamped from then on.
  return existing.inputsHash === inputsHash();
}

if (isUpToDate()) {
  console.log('help-docs corpus is up to date — skipping rebuild (resources/help-docs/corpus.json)');
  process.exit(0);
}

const chunks = extractDocsCorpus(DOCS_DIR);
if (chunks.length === 0) {
  throw new Error(`no chunks extracted from ${CONTENT_PATH} — is website/docs/_content/ present?`);
}

// Embedding all ~500 chunks in one batch pads every row to the single
// longest sequence in the whole corpus and holds every layer's
// intermediate activations for the full batch at once — fine on a dev
// machine, but enough to OOM (std::bad_alloc from the WASM runtime) on a
// memory-constrained CI runner. Batching bounds peak memory to one
// batch's worth regardless of corpus size.
const EMBED_BATCH_SIZE = 32;

const embedder = await createWasmEmbedder({ resourcesBase: path.join(ROOT, 'resources') });
try {
  const texts = chunks.map((c) => c.text);
  const vectors = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
    vectors.push(...await embedder.embed(batch));
  }
  const corpus = {
    model: MODEL.name,
    dim: MODEL.dim,
    // What this was built from (#2246) — see `isUpToDate`.
    inputsHash: inputsHash(),
    generatedAt: new Date().toISOString(),
    chunks: chunks.map((c, i) => ({ ...c, vector: Array.from(vectors[i]) })),
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(corpus));

  const sizeKb = Math.round(fs.statSync(OUT_FILE).size / 1024);
  console.log(`help-docs corpus built: ${chunks.length} chunks from website/docs/_content/ → resources/help-docs/corpus.json (${sizeKb} KB)`);
} finally {
  await embedder.dispose();
}
