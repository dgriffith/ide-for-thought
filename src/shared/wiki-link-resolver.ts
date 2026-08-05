/**
 * Resolve a wiki-link target string to an actual project-relative note path,
 * and canonicalise a target to a chosen path style. Pure — only needs the note
 * list (+ optional frontmatter alias map) — so both the renderer (navigation)
 * and the main-side formatter orchestrator (#778) use it.
 *
 * Targets resolve to any note extension (`.md`/`.ttl`/`.csv`/`.py`), not just
 * markdown (#1446). A bare `[[budget]]` prefers `.md` when several stems
 * collide (see `noteExtRank`); an explicit `[[budget.csv]]` bypasses that via an
 * exact-path match (step 0 below).
 *
 * Resolution priority:
 *   0. Explicit extension — exact relativePath match (so `[[budget.csv]]` reaches
 *      the CSV even when `budget.md` exists)
 *   1. Exact relativePath match (with or without a note extension)
 *   2. Basename match — case-sensitive
 *   3. Frontmatter alias (case-insensitive), if a map is provided (#469)
 *   4. Slugified basename match (case-insensitive, punctuation-fuzzy)
 *   5. Slugified full stem match (handles "journey/raft" → "notes/topic/journey/raft.md")
 *   6. Path-suffix slug match for unambiguous tails of nested paths
 */

import type { NoteFile } from './types';
import { isNotePath, stripNoteExt, noteExtRank } from './note-extensions';

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

const slug = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export type NoteFileLike = Pick<NoteFile, 'relativePath' | 'isDirectory'>;

/** Note files only, sorted so a lower `noteExtRank` (`.md` = 0) comes first.
 *  `Array.prototype.sort` is stable, so files of the same extension keep their
 *  input order — this makes bare-link precedence (`budget.md` over `budget.csv`)
 *  deterministic regardless of the order the caller passes files in. */
function orderedNoteFiles(files: NoteFileLike[]): NoteFileLike[] {
  return files
    .filter((f) => !f.isDirectory && isNotePath(f.relativePath))
    .sort((a, b) => noteExtRank(a.relativePath) - noteExtRank(b.relativePath));
}

/**
 * Returns the project-relative path of the matched note (with its real
 * extension), or null when nothing matches. A target carrying an explicit note
 * extension is honored first (step 0); otherwise it's treated as a stem.
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
  const noteFiles = orderedNoteFiles(files);

  // 0. Explicit extension: a deliberately-typed `[[budget.csv]]` honors the
  //    extension, reaching the CSV even when a same-stem `.md` exists (which
  //    step 1's md-first precedence would otherwise pick). A slashed target is a
  //    full path (exact match only); a bare one matches by basename-with-ext.
  if (isNotePath(target)) {
    for (const f of noteFiles) {
      if (f.relativePath === target) return f.relativePath;
    }
    if (!target.includes('/')) {
      for (const f of noteFiles) {
        if ((f.relativePath.split('/').pop() ?? '') === target) return f.relativePath;
      }
    }
  }

  const targetStem = stripNoteExt(target);
  const targetSlug = slug(targetStem);

  // 1. Exact relativePath
  for (const f of noteFiles) {
    if (stripNoteExt(f.relativePath) === targetStem) return f.relativePath;
  }

  // 2. Basename exact (case-sensitive)
  for (const f of noteFiles) {
    const base = stripNoteExt(f.relativePath.split('/').pop() ?? '');
    if (base === targetStem) return f.relativePath;
  }

  // 3. Frontmatter alias (case-insensitive), if a map was supplied.
  if (aliases) {
    const hit = aliases[targetStem.toLowerCase()];
    if (hit) return hit;
  }

  // 4. Basename slug match
  for (const f of noteFiles) {
    const base = stripNoteExt(f.relativePath.split('/').pop() ?? '');
    if (slug(base) === targetSlug) return f.relativePath;
  }

  // 5. Full-stem slug match (target like "notes/topic/raft" against the
  //    file's full stem slug)
  for (const f of noteFiles) {
    if (slug(stripNoteExt(f.relativePath)) === targetSlug) return f.relativePath;
  }

  // 6. Path-suffix slug match — target slug ends a file's full-stem slug at
  //    a "-" boundary (so "journey-raft" matches "notes-topic-journey-raft"
  //    but "raft" does NOT match "notes-craft" coincidentally — that's
  //    caught by step 4). Useful for "[[journey/raft]]"-style tail links.
  if (targetSlug.length > 0) {
    for (const f of noteFiles) {
      const fullSlug = slug(stripNoteExt(f.relativePath));
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
  /** Exact relativePath identity map (step 0) — an explicit `[[reports/budget.csv]]`. */
  byRelPath: Map<string, string>;
  /** Basename-with-extension → relativePath (step 0) — a bare `[[budget.csv]]`. */
  byBasenameExt: Map<string, string>;
  byStem: Map<string, string>;
  byBasename: Map<string, string>;
  bySlugBase: Map<string, string>;
  bySlugStem: Map<string, string>;
  /** Slug tails at a `-` boundary (step 6), excluding the whole stem (step 5). */
  bySuffixSlug: Map<string, string>;
  aliases: Record<string, string>;
}

export function buildWikiLinkIndex(files: NoteFileLike[], aliases: Record<string, string> = {}): WikiLinkIndex {
  const byRelPath = new Map<string, string>();
  const byBasenameExt = new Map<string, string>();
  const byStem = new Map<string, string>();
  const byBasename = new Map<string, string>();
  const bySlugBase = new Map<string, string>();
  const bySlugStem = new Map<string, string>();
  const bySuffixSlug = new Map<string, string>();
  const set = (m: Map<string, string>, k: string, v: string) => { if (k && !m.has(k)) m.set(k, v); };
  // md-first order so first-writer-wins yields `.md` precedence, matching the
  // loop resolver's `orderedNoteFiles` scan (verified equivalent in tests).
  for (const f of orderedNoteFiles(files)) {
    const rel = f.relativePath;
    const stem = stripNoteExt(rel);
    const base = stem.split('/').pop() ?? '';
    const sStem = slug(stem);
    set(byRelPath, rel, rel);
    set(byBasenameExt, rel.split('/').pop() ?? '', rel);
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
  return { byRelPath, byBasenameExt, byStem, byBasename, bySlugBase, bySlugStem, bySuffixSlug, aliases };
}

/** O(1) equivalent of `resolveWikiLinkTarget` using a prebuilt `WikiLinkIndex`.
 *  Verified to match the loop-based resolver in wiki-link-resolver.test.ts. */
export function resolveWikiLinkTargetWithIndex(target: string, index: WikiLinkIndex): string | null {
  // Step 0: explicit extension → exact path, or basename-with-ext for a bare
  //         target (mirrors the loop resolver).
  if (isNotePath(target)) {
    const hit = index.byRelPath.get(target)
      ?? (target.includes('/') ? undefined : index.byBasenameExt.get(target));
    if (hit) return hit;
  }
  const stem = stripNoteExt(target);
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
  const stem = stripNoteExt(full);
  if (style === 'absolute') return stem;

  const noteStems = files
    .filter((f) => !f.isDirectory && isNotePath(f.relativePath))
    .map((f) => stripNoteExt(f.relativePath));
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

/**
 * The canonical path for "Create Note From Reference" (#1446): the new `.md`
 * note lands **beside the referencing note**. The basename is the link target's
 * own basename (any directory part is dropped — wiki-links are basename-scoped;
 * any `#anchor` and note extension are stripped); the directory is the
 * referencing note's folder. Shared by the inspection quick-fix (main) and the
 * in-editor Alt-Enter quick-fix (renderer) so both create at the same place.
 */
export function noteTargetPathBeside(referencingPath: string, target: string): string {
  const noAnchor = target.split('#')[0] ?? target;
  const base = stripNoteExt(noAnchor.split('/').pop() ?? noAnchor);
  const slashIdx = referencingPath.lastIndexOf('/');
  const dir = slashIdx >= 0 ? referencingPath.slice(0, slashIdx) : '';
  return dir ? `${dir}/${base}.md` : `${base}.md`;
}
