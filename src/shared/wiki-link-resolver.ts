/**
 * Resolve a wiki-link target string to an actual project-relative `.md`
 * path, and canonicalise a target to a chosen path style. Pure — only needs
 * the note list (+ optional frontmatter alias map) — so both the renderer
 * (navigation) and the main-side formatter orchestrator (#778) use it.
 *
 * Resolution priority:
 *   1. Exact relativePath match (with or without .md)
 *   2. Basename match — case-sensitive
 *   3. Frontmatter alias (case-insensitive), if a map is provided (#469)
 *   4. Slugified basename match (case-insensitive, punctuation-fuzzy)
 *   5. Slugified full stem match (handles "journey/raft" → "notes/topic/journey/raft.md")
 *   6. Path-suffix slug match for unambiguous tails of nested paths
 */

import type { NoteFile } from './types';

export function flattenNoteFiles(tree: NoteFile[]): NoteFile[] {
  const out: NoteFile[] = [];
  const walk = (nodes: NoteFile[]) => {
    for (const n of nodes) {
      if (n.isDirectory) {
        if (n.children) walk(n.children);
      } else {
        out.push(n);
      }
    }
  };
  walk(tree);
  return out;
}

const stripMd = (s: string) => s.replace(/\.md$/i, '');
const slug = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

type NoteFileLike = Pick<NoteFile, 'relativePath' | 'isDirectory'>;

/**
 * Returns the project-relative path of the matched note (with .md), or
 * null when nothing matches. Targets ending in `.md` are tried as-is
 * first, otherwise treated as a stem.
 *
 * `aliases` is a frontmatter alias → relativePath map (#469). Title /
 * filename matches always win over aliases — the indexer's
 * rebuildAliasMap already drops alias keys that collide with canonical
 * names, so the alias check sits between basename and slug-fuzzy
 * resolution.
 */
export function resolveWikiLinkTarget(
  target: string,
  files: NoteFileLike[],
  aliases?: Record<string, string>,
): string | null {
  const targetStem = stripMd(target);
  const targetSlug = slug(targetStem);

  const noteFiles = files.filter((f) => !f.isDirectory && f.relativePath.endsWith('.md'));

  // 1. Exact relativePath
  for (const f of noteFiles) {
    if (stripMd(f.relativePath) === targetStem) return f.relativePath;
  }

  // 2. Basename exact (case-sensitive)
  for (const f of noteFiles) {
    const base = stripMd(f.relativePath.split('/').pop() ?? '');
    if (base === targetStem) return f.relativePath;
  }

  // 3. Frontmatter alias (case-insensitive), if a map was supplied.
  if (aliases) {
    const hit = aliases[targetStem.toLowerCase()];
    if (hit) return hit;
  }

  // 4. Basename slug match
  for (const f of noteFiles) {
    const base = stripMd(f.relativePath.split('/').pop() ?? '');
    if (slug(base) === targetSlug) return f.relativePath;
  }

  // 5. Full-stem slug match (target like "notes/topic/raft" against the
  //    file's full stem slug)
  for (const f of noteFiles) {
    if (slug(stripMd(f.relativePath)) === targetSlug) return f.relativePath;
  }

  // 6. Path-suffix slug match — target slug ends a file's full-stem slug at
  //    a "-" boundary (so "journey-raft" matches "notes-topic-journey-raft"
  //    but "raft" does NOT match "notes-craft" coincidentally — that's
  //    caught by step 4). Useful for "[[journey/raft]]"-style tail links.
  if (targetSlug.length > 0) {
    for (const f of noteFiles) {
      const fullSlug = slug(stripMd(f.relativePath));
      if (fullSlug === targetSlug) continue; // already covered by step 5
      if (fullSlug.endsWith(`-${targetSlug}`) || fullSlug.endsWith(`/${targetSlug}`)) {
        return f.relativePath;
      }
    }
  }

  return null;
}

/**
 * Precomputed lookup index for `resolveWikiLinkTargetWithIndex` (#1473). The
 * loop-based `resolveWikiLinkTarget` re-scans every note file on every call —
 * O(files) per link — which is O(N²) when the indexer resolves a link in each
 * of N notes. This flattens the same six-step precedence into maps built once
 * (O(N)), so each resolution is an O(1) lookup. Each map keeps the FIRST file
 * in `files` order for a given key, matching the loops' first-match-wins.
 */
export interface WikiLinkIndex {
  byStem: Map<string, string>;
  byBasename: Map<string, string>;
  bySlugBase: Map<string, string>;
  bySlugStem: Map<string, string>;
  /** Slug tails at a `-` boundary (step 6), excluding the whole stem (step 5). */
  bySuffixSlug: Map<string, string>;
  aliases: Record<string, string>;
}

export function buildWikiLinkIndex(files: NoteFileLike[], aliases: Record<string, string> = {}): WikiLinkIndex {
  const byStem = new Map<string, string>();
  const byBasename = new Map<string, string>();
  const bySlugBase = new Map<string, string>();
  const bySlugStem = new Map<string, string>();
  const bySuffixSlug = new Map<string, string>();
  const set = (m: Map<string, string>, k: string, v: string) => { if (k && !m.has(k)) m.set(k, v); };
  for (const f of files) {
    if (f.isDirectory || !f.relativePath.endsWith('.md')) continue;
    const rel = f.relativePath;
    const stem = stripMd(rel);
    const base = stem.split('/').pop() ?? '';
    const sStem = slug(stem);
    set(byStem, stem, rel);
    set(byBasename, base, rel);
    set(bySlugBase, slug(base), rel);
    set(bySlugStem, sStem, rel);
    // slug() maps '/' → '-', so a stem's slug is dash-joined; step 6's tails are
    // the last k dash-segments for k < segments.length (k = all is step 5).
    if (sStem) {
      const parts = sStem.split('-');
      for (let k = 1; k < parts.length; k++) set(bySuffixSlug, parts.slice(parts.length - k).join('-'), rel);
    }
  }
  return { byStem, byBasename, bySlugBase, bySlugStem, bySuffixSlug, aliases };
}

/** O(1) equivalent of `resolveWikiLinkTarget` using a prebuilt `WikiLinkIndex`.
 *  Verified to match the loop-based resolver in wiki-link-resolver.test.ts. */
export function resolveWikiLinkTargetWithIndex(target: string, index: WikiLinkIndex): string | null {
  const stem = stripMd(target);
  const s = slug(stem);
  return index.byStem.get(stem)
    ?? index.byBasename.get(stem)
    ?? index.aliases[stem.toLowerCase()]
    ?? (s ? index.bySlugBase.get(s) : undefined)
    ?? (s ? index.bySlugStem.get(s) : undefined)
    ?? (s ? index.bySuffixSlug.get(s) : undefined)
    ?? null;
}

export type WikiLinkPathStyle = 'absolute' | 'shortest';

/**
 * Canonicalise a wiki-link's path part (#778). Returns the rewritten target,
 * or null when `target` doesn't resolve to a note (broken / source / excerpt
 * links are left untouched by the caller).
 *
 * - `absolute` → the note's full-from-root stem (`notes/topic/raft`).
 * - `shortest` → the fewest trailing path segments that are *globally
 *   unique* among note stems (so two `raft.md` files both grow to a longer
 *   form rather than one silently winning the bare basename), and that the
 *   resolver still maps back to this file. Order-independent.
 */
export function canonicalizeWikiLinkTarget(
  target: string,
  style: WikiLinkPathStyle,
  files: NoteFileLike[],
  aliases?: Record<string, string>,
): string | null {
  const full = resolveWikiLinkTarget(target, files, aliases);
  if (!full) return null;
  const stem = stripMd(full);
  if (style === 'absolute') return stem;

  const noteStems = files
    .filter((f) => !f.isDirectory && f.relativePath.endsWith('.md'))
    .map((f) => stripMd(f.relativePath));
  const suffix = (s: string, t: number) => s.split('/').slice(-t).join('/');
  const segs = stem.split('/');
  for (let t = 1; t <= segs.length; t++) {
    const candidate = segs.slice(segs.length - t).join('/');
    const uniqueMatch = noteStems.filter((s) => suffix(s, t) === candidate).length === 1;
    if (uniqueMatch && resolveWikiLinkTarget(candidate, files, aliases) === full) {
      return candidate;
    }
  }
  return stem;
}
