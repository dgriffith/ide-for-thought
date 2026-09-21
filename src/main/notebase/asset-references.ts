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
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { INLINE_ASSET_DIR, type OrphanedAsset } from '../../shared/asset-paths';

export type { OrphanedAsset };

// The usual project-hygiene exclusions, plus the asset trees themselves
// (binary images; nothing meaningfully references a sibling by embedding it)
// and the publish cache — a build OUTPUT, so a copy living there doesn't
// make the SOURCE asset referenced (scope explicitly excludes it, #1799).
const EXCLUDED_DIR_NAMES = new Set(['.git', 'node_modules', '.obsidian']);
const EXCLUDED_MINERVA_DIRS = new Set(['.minerva/assets', '.minerva/publish-cache']);

// Extensions that can't meaningfully hold a text reference to an asset,
// skipped purely for scan speed, never for correctness — a live reference
// existing ONLY inside a binary file isn't a link Minerva itself can create.
const SKIPPED_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.ico',
  '.pdf', '.zip', '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.mp3', '.mp4', '.mov', '.wasm', '.db', '.sqlite',
]);

// A defensive bound, not a correctness one: a legitimate reference lives in a
// note, a stylesheet, or a history snapshot — all small text by construction
// (mirrors history/settings.ts's own "notes are small text" reasoning).
const MAX_SCAN_FILE_BYTES = 20 * 1024 * 1024;

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
    // Best-effort: a file that vanished between readdir and stat (deleted
    // concurrently) just isn't a candidate anymore, not a real failure.
    const stat = await fs.stat(path.join(dir, entry.name)).catch(() => null);
    if (!stat) continue;
    assets.push({ relativePath: `${INLINE_ASSET_DIR}/${entry.name}`, sizeBytes: stat.size });
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
      if (!SKIPPED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) out.push(rel);
    }
  }
}

/** Every `.minerva/assets/inline/` file that nothing in the project's current
 *  text or retained history references. Empty when the asset dir doesn't
 *  exist or is empty — the common case is resolved before any corpus scan
 *  runs, so a thoughtbase with no pasted images pays nothing for this check. */
export async function findOrphanedInlineAssets(rootPath: string): Promise<OrphanedAsset[]> {
  const assets = await listInlineAssets(rootPath);
  if (assets.length === 0) return [];

  const remaining = new Map(assets.map((a) => [path.basename(a.relativePath), a]));
  const files: string[] = [];
  await walk(rootPath, rootPath, files);

  for (const rel of files) {
    if (remaining.size === 0) break; // every asset already accounted for
    const abs = path.join(rootPath, rel);
    // Best-effort, same reasoning as listInlineAssets: a corpus file deleted
    // mid-walk just contributes nothing, rather than failing the whole check.
    const stat = await fs.stat(abs).catch(() => null);
    if (!stat || stat.size > MAX_SCAN_FILE_BYTES) continue;
    let content: string;
    try {
      content = await fs.readFile(abs, 'utf-8');
    } catch {
      continue; // unreadable — treat conservatively as "can't tell", not "orphaned"
    }
    for (const basename of [...remaining.keys()]) {
      if (content.includes(basename)) remaining.delete(basename);
    }
  }

  return [...remaining.values()];
}
