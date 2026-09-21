/**
 * The note path + frontmatter-alias index, split out of `GraphState`
 * (#2234, PR 2/3, epic #2241).
 *
 * PR 1 moved the three derived caches that were simply co-located with the
 * triple store. This is the other half of `GraphState`'s "derived UI caches"
 * bundle, and unlike those three it is not three independent maps — it is one
 * index with three representations, maintained together:
 *
 *   - **`paths`** — every relativePath the indexer has touched. A superset of
 *     `aliasesPerNote.keys()`: notes WITHOUT aliases still count, because a
 *     real file at `JFK.md` has to beat some other note's "JFK" alias.
 *   - **`aliasesPerNote`** — the strings the indexer last accepted from each
 *     note's frontmatter. Per-note so `indexNote` can patch the map without
 *     re-walking the project (#469).
 *   - **`aliasMap`** — lowercased alias → relativePath, derived from the two
 *     above by `rebuildAliasMap` and cached because wiki-link resolution reads
 *     it on every link.
 *
 * ── The duplication this removes ────────────────────────────────────────────
 * The alias conflict policy — alphabetical-first-writer wins, and a real
 * note's canonical name beats any alias — was implemented TWICE: once in
 * `rebuildAliasMap` (building the lowercased map) and once in
 * `getAliasEntries` (building the original-cased entries the autocomplete
 * needs). The second carried a comment saying it "matches rebuildAliasMap's
 * second pass", which is exactly the kind of invariant-by-comment #2234 is
 * about: two implementations of one rule, in different files, with nothing
 * checking they agree.
 *
 * `resolveAliases` below is now the single implementation. Both
 * representations are projections of its output, so they cannot disagree
 * about which alias won.
 */
import type { ProjectContext } from '../project-context-types';
import { createProjectStore } from '../project-store';
import { stripNoteExt } from '../../shared/note-extensions';

interface NoteIndex {
  paths: Set<string>;
  aliasesPerNote: Map<string, string[]>;
  /** Derived from the two above; recomputed by `rebuildAliasMap`. */
  aliasMap: Map<string, string>;
}

const noteIndexStore = createProjectStore<NoteIndex>();

function index(ctx: ProjectContext): NoteIndex {
  const existing = noteIndexStore.get(ctx);
  if (existing) return existing;
  const fresh: NoteIndex = { paths: new Set(), aliasesPerNote: new Map(), aliasMap: new Map() };
  noteIndexStore.set(ctx, fresh);
  return fresh;
}

// ── The conflict policy, in one place ───────────────────────────────────────

/** One alias that survived the conflict rules, with its original casing. */
export interface AliasEntry {
  alias: string;
  relativePath: string;
}

/**
 * Every alias that wins, in original casing, in deterministic order.
 *
 * Two rules, applied in this order:
 *   1. **Alphabetical first writer wins.** Note paths are sorted, so when two
 *      notes claim the same alias the lexicographically-smaller path takes it —
 *      deterministic regardless of index order.
 *   2. **Canonical names beat aliases.** An alias whose lowercase form collides
 *      with a real note's path stem OR its basename is dropped entirely, so a
 *      file at `JFK.md` always wins over another note's "JFK" alias.
 */
function resolveAliases(idx: NoteIndex): AliasEntry[] {
  const canonical = new Set<string>();
  for (const path of idx.paths) {
    const stem = stripNoteExt(path).toLowerCase();
    canonical.add(stem);
    const basename = stem.split('/').pop() ?? '';
    if (basename) canonical.add(basename);
  }

  const claimed = new Set<string>();
  const out: AliasEntry[] = [];
  for (const path of [...idx.aliasesPerNote.keys()].sort()) {
    for (const alias of idx.aliasesPerNote.get(path) ?? []) {
      const key = alias.toLowerCase();
      if (canonical.has(key) || claimed.has(key)) continue;
      claimed.add(key);
      out.push({ alias, relativePath: path });
    }
  }
  return out;
}

// ── Maintenance (the indexer's side) ────────────────────────────────────────

/**
 * Record that the indexer has seen `relativePath`. Called for EVERY note
 * extension (#1446) before the `.ttl`/`.csv`/`.py` early-returns, so a bare
 * `[[budget]]` resolves to `budget.csv` on the incremental path too — not just
 * on a full rebuild. Idempotent.
 */
export function registerNotePath(ctx: ProjectContext, relativePath: string): void {
  index(ctx).paths.add(relativePath);
}

/** Replace a note's accepted aliases. An empty list drops the entry entirely,
 *  so `aliasesPerNote` never holds empty arrays. */
export function setNoteAliases(ctx: ProjectContext, relativePath: string, aliases: string[]): void {
  const idx = index(ctx);
  if (aliases.length > 0) idx.aliasesPerNote.set(relativePath, aliases);
  else idx.aliasesPerNote.delete(relativePath);
}

/**
 * Drop a note. Returns what actually changed so `removeNote` can skip the
 * rebuild when nothing did — the caller needs both flags because a note with no
 * aliases still affects the map through the canonical-name rule.
 */
export function forgetNotePath(
  ctx: ProjectContext,
  relativePath: string,
): { hadAliases: boolean; wasTracked: boolean } {
  const idx = noteIndexStore.get(ctx);
  if (!idx) return { hadAliases: false, wasTracked: false };
  return {
    hadAliases: idx.aliasesPerNote.delete(relativePath),
    wasTracked: idx.paths.delete(relativePath),
  };
}

/**
 * Recompute the cached lowercase alias map. Run after any change to the
 * per-note snapshots — the incremental `indexNote` path and the full reindex
 * both call it. The full-rebuild walk deliberately skips the per-note call and
 * does one pass at the end (perf #1106): it's O(notes), so calling it per note
 * made the walk O(n²).
 */
export function rebuildAliasMap(ctx: ProjectContext): void {
  const idx = index(ctx);
  const next = new Map<string, string>();
  for (const { alias, relativePath } of resolveAliases(idx)) {
    next.set(alias.toLowerCase(), relativePath);
  }
  idx.aliasMap = next;
}

/** Drop the whole index — the from-scratch rebuild re-derives it from files. */
export function clearNoteIndex(ctx: ProjectContext): void {
  const idx = noteIndexStore.get(ctx);
  if (!idx) return;
  idx.paths.clear();
  idx.aliasesPerNote.clear();
  idx.aliasMap.clear();
}

// ── Reads ───────────────────────────────────────────────────────────────────

/** Lowercased alias → relativePath. The live map; callers must not mutate it. */
export function aliasMap(ctx: ProjectContext): Map<string, string> {
  return noteIndexStore.get(ctx)?.aliasMap ?? new Map<string, string>();
}

/** Lowercased alias → relativePath as a plain object, for the IPC boundary. */
export function aliasMapObject(ctx: ProjectContext): Record<string, string> {
  return Object.fromEntries(aliasMap(ctx));
}

/**
 * Winning aliases in their ORIGINAL casing (#492). `aliasMap` lowercases for
 * case-insensitive resolution; the wiki-link autocomplete needs the original so
 * picking a suggestion inserts `[[JFK]]`, not `[[jfk]]`. Same conflict policy —
 * literally the same function — as the map above.
 */
export function aliasEntries(ctx: ProjectContext): AliasEntry[] {
  const idx = noteIndexStore.get(ctx);
  return idx ? resolveAliases(idx) : [];
}

/** The frontmatter aliases a single note declared (#1074). */
export function aliasesForNote(ctx: ProjectContext, relativePath: string): string[] {
  return noteIndexStore.get(ctx)?.aliasesPerNote.get(relativePath) ?? [];
}

/** Every relativePath the indexer has touched, in insertion order. */
export function indexedNotePaths(ctx: ProjectContext): string[] {
  return [...(noteIndexStore.get(ctx)?.paths ?? [])];
}
