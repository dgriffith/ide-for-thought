/**
 * Finds `.minerva/assets/inline/` files nothing currently references (#1799)
 * — the plumbing behind the "unreferenced image" inspection.
 *
 * Detection is deliberately crude rather than syntax-aware: instead of
 * parsing every way an asset could be referenced (markdown images, raw
 * `<img>`, a `publish: css:` stylesheet's `url(...)`, `.minerva/site.css`,
 * ...), it checks whether each asset's content-addressed filename —
 * `<sha-prefix>-<safe-stem>.<ext>`, made globally unique and character-safe
 * by `uploadImage` (`editor/image-upload.ts`) — appears as a plain substring
 * ANYWHERE in the project's text. That's a strict superset of every syntax
 * above (and anything not thought of): a false "still referenced" verdict
 * costs nothing but a missed cleanup, while a false "orphaned" verdict
 * deletes a live image — the failure mode #1799 explicitly designs against —
 * so this errs toward the safe side, never toward completeness of detection.
 *
 * The corpus is every (non-binary, non-excluded) file in the project, not
 * just `.md` notes — which picks up `publish: css:` stylesheets and
 * `.minerva/site.css` for free, and, because `.minerva/history/**\/*.snap`
 * files are plain content files on disk (`history/store.ts`'s own words:
 * "so a note's past is inspectable... even if the app breaks"), every
 * retained history snapshot too. A revision whose content already aged out
 * or was compacted (#2167) simply has no `.snap` file, so it silently drops
 * out of the corpus — no special-casing needed for delete markers, compacted
 * baselines, or anything else the retention policy does.
 *
 * ── What this costs, measured (#2208 C1c) ──────────────────────────────────
 *
 * The issue filed this as "structural, unmeasured". Measured, on a project of
 * 1,000 notes with 20 retained revisions each — 21,005 files, the shape a
 * year-old thoughtbase actually has — the original serial stat-then-read of
 * every file took **5.8-6.5 seconds**, against ~1.8s for all seventeen SPARQL
 * queries in the same sweep. It was not the rounding error the issue's
 * ordering implies; it was the single largest thing in the burst by a factor
 * of three.
 *
 * The decomposition says where it went, and it is not where the issue's fix
 * list points:
 *
 *   | step                                    | 21,005 files |
 *   |-----------------------------------------|--------------|
 *   | `readdir` walk alone                    |   166-312ms  |
 *   | + `stat` each, serially                 |   663-835ms  |
 *   | + `stat` each, 32-way                   |   273-376ms  |
 *   | + `readFile` each, serially             | 2,657-3,834ms|
 *   | + `readFile` each, 32-way               |   824-1,352ms|
 *   | `findOrphanedInlineAssets` (as shipped) | 5,660-6,516ms|
 *
 * Raising the asset count from 5 to 100 moved the total by ~3% (5,818ms →
 * 5,660ms, i.e. inside the noise). So the O(F x A) `includes` loop the issue
 * proposes replacing with a single-pass O(F+A) match **was never the cost** —
 * the cost is F file reads, and no amount of cleverness about matching
 * removes one of them.
 *
 * What removes them is not re-reading a file that hasn't changed. Three
 * changes, in the order they matter:
 *
 *   1. **A per-file memo** keyed on `size:mtimeMs`, in a `createProjectStore`
 *      slot (#2240 — a hand-rolled `Map` keyed by rootPath would be invisible
 *      to `disposeAllProjectStores` and leak a whole corpus per closed
 *      thoughtbase). A steady-state run now reads only the files that changed
 *      since the last one, and a `.snap` is immutable once written, so the
 *      20,000 that dominate this corpus are read exactly once per session.
 *   2. **Bounded-concurrency I/O.** These are awaited reads, not CPU, so
 *      running them 16-deep is a straight ~3x on the one run that does have
 *      to read everything (project open).
 *   3. **Single-pass matching** (the issue's item 3), which buys no measurable
 *      time on its own but is what makes (1) possible: the memo's value has to
 *      be independent of the current asset set, so it stores the file's
 *      distinct filename-shaped TOKENS rather than "which of these five assets
 *      did I see".
 *
 * The tokenisation is exactly equivalent to the substring scan it replaces,
 * and `assertTokenisable` below is what keeps it that way rather than leaving
 * it as a claim in a comment.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { INLINE_ASSET_DIR, type OrphanedAsset } from '../../shared/asset-paths';
import { createProjectStore } from '../project-store';
import { projectContext } from '../project-context-types';

export type { OrphanedAsset };

// The usual project-hygiene exclusions, plus the asset trees themselves
// (binary images; nothing meaningfully references a sibling by embedding it)
// and the publish cache — a build OUTPUT, so a copy living there doesn't
// make the SOURCE asset referenced (scope explicitly excludes it, #1799).
const EXCLUDED_DIR_NAMES = new Set(['.git', 'node_modules', '.obsidian']);
const EXCLUDED_MINERVA_DIRS = new Set([
  '.minerva/assets',
  '.minerva/publish-cache',
  // Fetched copies of REMOTE images (`images/remote-image-cache.ts`,
  // `youtube/thumbnail-cache.ts`), stored under content-hashed and often
  // extensionless names. Same argument as publish-cache: a cached copy of
  // something fetched from the network can't be what references a local
  // asset, and the entries are binary, so reading them is pure waste (#2208).
  '.minerva/cache',
]);

// Derived indexes over content this scan already reads in its original form.
// A note that references an asset is itself in the corpus, so the derived copy
// can only ever repeat a hit we already have — while being one of the largest
// files in the project (#2208).
const EXCLUDED_MINERVA_FILES = new Set(['.minerva/search-index.json']);

// Extensions that can't meaningfully hold a text reference to an asset,
// skipped purely for scan speed, never for correctness — a live reference
// existing ONLY inside a binary file isn't a link Minerva itself can create.
const SKIPPED_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.ico',
  '.pdf', '.zip', '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.mp3', '.mp4', '.mov', '.wasm', '.db', '.sqlite',
  // `.minerva/vectors.duckdb` plus its write-ahead log — a multi-hundred-MB
  // binary the scan used to read in full (#2208).
  '.duckdb', '.wal',
]);

// A defensive bound, not a correctness one: a legitimate reference lives in a
// note, a stylesheet, or a history snapshot — all small text by construction
// (mirrors history/settings.ts's own "notes are small text" reasoning).
const MAX_SCAN_FILE_BYTES = 20 * 1024 * 1024;

/** How many files to read at once. These are awaited I/O, so the event loop
 *  stays responsive between them; the bound is about file descriptors, not
 *  about politeness to the CPU. */
const READ_CONCURRENCY = 16;

/**
 * The characters that can appear in a name `uploadImage` generates:
 * `${sha256.slice(0, n)}-${stem}.${ext}` where the stem is lowercased through
 * `/[^a-z0-9_-]+/g → '-'` and the extension is `[a-zA-Z0-9]+`. Nothing else.
 */
const TOKEN_CHARS = /[A-Za-z0-9._-]+/g;
const TOKENISABLE = /^[A-Za-z0-9._-]+$/;

/**
 * `stat`, or null when the file isn't there any more.
 *
 * ENOENT is the expected case and the only one this swallow is for: a corpus
 * file deleted between the `readdir` that listed it and the `stat` that reads
 * it just isn't a candidate any more, which is not a failure of the scan. One
 * helper rather than a `.catch(() => null)` at each of the three call sites,
 * so there is one place saying which error is being ignored and why.
 *
 * `bigint: true` for `mtimeNs` — see `ScannedFile.stamp`.
 */
async function statOrNull(abs: string): Promise<import('node:fs').BigIntStats | null> {
  return fs.stat(abs, { bigint: true }).catch(() => null);
}

async function listInlineAssets(rootPath: string): Promise<OrphanedAsset[]> {
  const dir = path.join(rootPath, INLINE_ASSET_DIR);
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return []; // no assets dir at all — the overwhelmingly common case
  }
  const assets: OrphanedAsset[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const stat = await statOrNull(path.join(dir, entry.name));
    if (!stat) continue;
    assets.push({ relativePath: `${INLINE_ASSET_DIR}/${entry.name}`, sizeBytes: Number(stat.size) });
  }
  return assets;
}

function isExcludedDir(rel: string, name: string): boolean {
  return EXCLUDED_DIR_NAMES.has(name) || EXCLUDED_MINERVA_DIRS.has(rel);
}

async function walk(absDir: string, rootPath: string, out: string[]): Promise<void> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const absPath = path.join(absDir, entry.name);
    const rel = path.relative(rootPath, absPath).split(path.sep).join('/');
    if (entry.isDirectory()) {
      if (isExcludedDir(rel, entry.name)) continue;
      await walk(absPath, rootPath, out);
    } else if (entry.isFile()) {
      if (EXCLUDED_MINERVA_FILES.has(rel)) continue;
      if (!SKIPPED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) out.push(rel);
    }
  }
}

// ── The per-file memo ───────────────────────────────────────────────────────

interface ScannedFile {
  /**
   * `size:mtimeNs`. The file is unchanged for as long as this holds.
   *
   * NANOseconds, via `stat(..., { bigint: true })`, not the millisecond
   * `mtimeMs` the obvious version of this uses. Two writes inside the same
   * millisecond that happen to land on the same byte count would otherwise
   * read as "unchanged", and the direction that fails is the dangerous one:
   * a note that just GAINED a reference would be judged by its previous
   * tokens, and the image it now displays would be reported as an orphan with
   * a Delete button beside it. Rare, but the cost of being wrong here is data
   * loss, and nanoseconds cost nothing.
   */
  stamp: string;
  /** Distinct filename-shaped tokens in the file's text. Asset-set
   *  independent on purpose — see the module header. */
  tokens: string[];
}

/**
 * Per-project scan memo. A `createProjectStore` slot rather than a
 * module-level `Map` keyed by rootPath (#2240): this holds one entry per file
 * in the project, so a thoughtbase closed without disposal would strand its
 * entire corpus, and `tests/architecture/project-state-registered.test.ts`
 * would (rightly) flag the hand-rolled map. Nothing to release beyond the
 * memory, so there is no `dispose` hook — dropping the map is the teardown.
 */
const scanMemo = createProjectStore<Map<string, ScannedFile>>();

function memoFor(rootPath: string): Map<string, ScannedFile> {
  const ctx = projectContext(rootPath);
  const existing = scanMemo.get(ctx);
  if (existing) return existing;
  const fresh = new Map<string, ScannedFile>();
  scanMemo.set(ctx, fresh);
  return fresh;
}

/** Every distinct maximal run of asset-name characters in `content`. */
function tokenise(content: string): string[] {
  return [...new Set(content.match(TOKEN_CHARS) ?? [])];
}

/**
 * Is every asset basename expressible as a token?
 *
 * `content.includes(name)` and "some token contains `name`" agree exactly when
 * `name` contains no token SEPARATOR — any occurrence of it then lies wholly
 * inside one maximal run of token characters. `uploadImage` can only produce
 * such names (see `TOKEN_CHARS`), so this holds for every asset the app
 * writes. It does not necessarily hold for a file a user dropped into
 * `.minerva/assets/inline/` by hand, and being wrong in that direction means
 * calling a LIVE image orphaned — the one failure mode #1799 designs against.
 * So it is checked rather than assumed, and the scan falls back to the plain
 * substring pass when it fails.
 */
function tokenisable(basenames: string[]): boolean {
  return basenames.every((b) => TOKENISABLE.test(b));
}

/** Run `fn` over `items`, at most `limit` in flight. */
async function eachLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]!;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

/** Every `.minerva/assets/inline/` file that nothing in the project's current
 *  text or retained history references. Empty when the asset dir doesn't
 *  exist or is empty — the common case is resolved before any corpus scan
 *  runs, so a thoughtbase with no pasted images pays nothing for this check. */
export async function findOrphanedInlineAssets(rootPath: string): Promise<OrphanedAsset[]> {
  const assets = await listInlineAssets(rootPath);
  if (assets.length === 0) return [];

  const files: string[] = [];
  await walk(rootPath, rootPath, files);

  const basenames = assets.map((a) => path.basename(a.relativePath));
  if (!tokenisable(basenames)) return scanBySubstring(rootPath, assets, files);

  // One entry per file that still exists, so a deleted file's tokens leave the
  // memo with it rather than keeping an asset alive forever.
  const previous = memoFor(rootPath);
  const current = new Map<string, ScannedFile>();
  const seen = new Set<string>();

  await eachLimited(files, READ_CONCURRENCY, async (rel) => {
    const abs = path.join(rootPath, rel);
    const stat = await statOrNull(abs);
    if (!stat || stat.size > BigInt(MAX_SCAN_FILE_BYTES)) return;
    const stamp = `${stat.size}:${stat.mtimeNs}`;

    const cached = previous.get(rel);
    if (cached?.stamp === stamp) {
      current.set(rel, cached);
      for (const t of cached.tokens) seen.add(t);
      return;
    }
    let content: string;
    try {
      content = await fs.readFile(abs, 'utf-8');
    } catch {
      return; // unreadable — treat conservatively as "can't tell", not "orphaned"
    }
    const tokens = tokenise(content);
    current.set(rel, { stamp, tokens });
    for (const t of tokens) seen.add(t);
  });

  scanMemo.set(projectContext(rootPath), current);

  // Exact (and overwhelmingly common) hit first; only a candidate orphan pays
  // for the substring sweep across the token set.
  return assets.filter((_asset, i) => {
    const name = basenames[i]!;
    if (seen.has(name)) return false;
    for (const token of seen) if (token.includes(name)) return false;
    return true;
  });
}

/**
 * The pre-#2208 pass, kept as the fallback for an asset whose name the
 * tokeniser cannot represent. Uncached and serial, which is fine: it runs only
 * for a hand-placed file with an unusual name, and correctness there matters
 * more than the milliseconds.
 */
async function scanBySubstring(
  rootPath: string,
  assets: OrphanedAsset[],
  files: string[],
): Promise<OrphanedAsset[]> {
  const remaining = new Map(assets.map((a) => [path.basename(a.relativePath), a]));
  for (const rel of files) {
    if (remaining.size === 0) break; // every asset already accounted for
    const abs = path.join(rootPath, rel);
    const stat = await statOrNull(abs);
    if (!stat || stat.size > BigInt(MAX_SCAN_FILE_BYTES)) continue;
    let content: string;
    try {
      content = await fs.readFile(abs, 'utf-8');
    } catch {
      continue;
    }
    for (const basename of [...remaining.keys()]) {
      if (content.includes(basename)) remaining.delete(basename);
    }
  }
  return [...remaining.values()];
}
