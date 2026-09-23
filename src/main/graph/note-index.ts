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
 *
 * ── Derivations are lazy and versioned (#2214) ──────────────────────────────
 * `aliasMap` and the wiki-link resolver index (`wikiLinkIndex`) are both pure
 * functions of `paths` + `aliasesPerNote`, and both are O(N) in the project's
 * note count to compute. They used to be recomputed eagerly on *every*
 * incremental save — `indexNote` called `rebuildAliasMap`, then
 * `buildLinkResolveCtx` rebuilt seven maps over every indexed path — so a save
 * in a 5,000-note thoughtbase paid ~21ms of pure rederivation before touching
 * a single triple, even for a note with no wiki-links and no aliases.
 *
 * Both are now cached against a `version` counter that the three mutators
 * (`registerNotePath` / `setNoteAliases` / `forgetNotePath`) bump only when
 * they *actually* change something. A save that re-indexes an already-known
 * path with unchanged aliases — the overwhelmingly common case — bumps
 * nothing, so both derivations are an O(1) version check.
 *
 * Correctness comes from the reads, not from callers remembering to rebuild:
 * every read (`aliasMap`, `aliasMapObject`, `aliasEntries`, `wikiLinkIndex`)
 * materializes on demand if its cache is behind `version`. `rebuildAliasMap`
 * is kept — `rebuild.ts` and `indexNote` still call it — but it is now a
 * version-guarded materialize rather than an unconditional O(N) pass, so a
 * stale cache is not reachable and a redundant call is free.
 */
import type { ProjectContext } from '../project-context-types';
import { createProjectStore } from '../project-store';
import { stripNoteExt } from '../../shared/note-extensions';
import { buildWikiLinkIndex, type WikiLinkIndex } from '../../shared/wiki-link-resolver';

interface NoteIndex {
  paths: Set<string>;
  aliasesPerNote: Map<string, string[]>;
  /**
   * Bumped by a mutator ONLY when `paths`/`aliasesPerNote` actually changed.
   * Everything derived below caches the version it was built from.
   */
  version: number;
  /** Derived from `paths` + `aliasesPerNote`; stale when `aliasMapVersion !== version`. */
  aliasMap: Map<string, string>;
  aliasMapVersion: number;
  /** Derived from `paths` + `aliasMap`; `null` until first built. */
  linkIndex: WikiLinkIndex | null;
  linkIndexVersion: number;
}

/**
 * Test-only: how many times each derivation was *actually* recomputed.
 *
 * #2214's gate is a count, not a timing (#2229): "a save rebuilds the wiki-link
 * index zero times when no path or alias changed" is a deterministic assertion;
 * "a save is faster" is not. Incrementing two module-level integers costs
 * nothing in production and is the only thing that can distinguish a cache hit
 * from a cheap rebuild from the outside.
 */
export const _derivationCountsForTests = { aliasMap: 0, linkIndex: 0 };

const noteIndexStore = createProjectStore<NoteIndex>();

function index(ctx: ProjectContext): NoteIndex {
  const existing = noteIndexStore.get(ctx);
  if (existing) return existing;
  const fresh: NoteIndex = {
    paths: new Set(),
    aliasesPerNote: new Map(),
    version: 0,
    aliasMap: new Map(),
    aliasMapVersion: 0,
    linkIndex: null,
    linkIndexVersion: -1,
  };
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

// ── Derivations (lazy, version-guarded) ─────────────────────────────────────

/** Materialize `aliasMap` if it is behind `version`. O(1) when it isn't. */
function ensureAliasMap(idx: NoteIndex): void {
  if (idx.aliasMapVersion === idx.version) return;
  const next = new Map<string, string>();
  for (const { alias, relativePath } of resolveAliases(idx)) {
    next.set(alias.toLowerCase(), relativePath);
  }
  idx.aliasMap = next;
  idx.aliasMapVersion = idx.version;
  _derivationCountsForTests.aliasMap++;
}

/** Materialize the wiki-link resolver index if it is behind `version`. */
function ensureLinkIndex(idx: NoteIndex): WikiLinkIndex {
  if (idx.linkIndex && idx.linkIndexVersion === idx.version) return idx.linkIndex;
  ensureAliasMap(idx);
  const files = [...idx.paths].map((relativePath) => ({ relativePath, isDirectory: false }));
  // aliasMap keys are already lowercased by resolveAliases' projection.
  idx.linkIndex = buildWikiLinkIndex(files, Object.fromEntries(idx.aliasMap));
  idx.linkIndexVersion = idx.version;
  _derivationCountsForTests.linkIndex++;
  return idx.linkIndex;
}

/** The answer for a project with nothing indexed. Built once — a read must not
 *  allocate anything per call, let alone a project slot (#2240). */
const EMPTY_LINK_INDEX: WikiLinkIndex = buildWikiLinkIndex([], {});

// ── Maintenance (the indexer's side) ────────────────────────────────────────

/**
 * Record that the indexer has seen `relativePath`. Called for EVERY note
 * extension (#1446) before the `.ttl`/`.csv`/`.py` early-returns, so a bare
 * `[[budget]]` resolves to `budget.csv` on the incremental path too — not just
 * on a full rebuild. Idempotent — and a repeat call is a genuine no-op, so it
 * does not invalidate the derived caches (#2214).
 */
export function registerNotePath(ctx: ProjectContext, relativePath: string): void {
  const idx = index(ctx);
  if (idx.paths.has(relativePath)) return;
  idx.paths.add(relativePath);
  idx.version++;
}

/** Replace a note's accepted aliases. An empty list drops the entry entirely,
 *  so `aliasesPerNote` never holds empty arrays. An unchanged list is a no-op
 *  (#2214) — most saves don't touch frontmatter aliases, and re-storing an
 *  equal array would invalidate both derived caches for nothing. */
export function setNoteAliases(ctx: ProjectContext, relativePath: string, aliases: string[]): void {
  const idx = index(ctx);
  const prev = idx.aliasesPerNote.get(relativePath);
  if (aliases.length > 0) {
    if (prev && prev.length === aliases.length && prev.every((a, i) => a === aliases[i])) return;
    idx.aliasesPerNote.set(relativePath, aliases);
  } else {
    if (!idx.aliasesPerNote.delete(relativePath)) return;
  }
  idx.version++;
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
  const out = {
    hadAliases: idx.aliasesPerNote.delete(relativePath),
    wasTracked: idx.paths.delete(relativePath),
  };
  if (out.hadAliases || out.wasTracked) idx.version++;
  return out;
}

/**
 * Materialize the cached lowercase alias map if a mutation has invalidated it.
 *
 * Callers (the incremental `indexNote` path, `removeNote`, and the full
 * reindex's two explicit passes) are unchanged, but since #2214 this is a
 * version check first: a save whose paths and aliases are identical to what's
 * already indexed does no work at all. The reads below materialize on demand
 * too, so a caller that forgets this is still correct — the eager calls just
 * keep the cost off the first reader.
 *
 * The full-rebuild walk still skips the per-note call (perf #1106); the
 * pre-pass + one trailing call are all it needs.
 */
export function rebuildAliasMap(ctx: ProjectContext): void {
  ensureAliasMap(index(ctx));
}

/** Drop the whole index — the from-scratch rebuild re-derives it from files. */
export function clearNoteIndex(ctx: ProjectContext): void {
  const idx = noteIndexStore.get(ctx);
  if (!idx) return;
  idx.paths.clear();
  idx.aliasesPerNote.clear();
  idx.aliasMap.clear();
  // Both derivations are now stale, whatever they held. `aliasMap` was just
  // emptied in place, which happens to be its correct value for an empty
  // index — but the version bump is what keeps that a fact rather than a
  // coincidence, and it is what invalidates `linkIndex`.
  idx.version++;
  idx.aliasMapVersion = idx.version;
}

// ── Reads ───────────────────────────────────────────────────────────────────

/** Lowercased alias → relativePath. The live map; callers must not mutate it. */
export function aliasMap(ctx: ProjectContext): Map<string, string> {
  const idx = noteIndexStore.get(ctx);
  if (!idx) return new Map<string, string>();
  ensureAliasMap(idx);
  return idx.aliasMap;
}

/**
 * The prebuilt wiki-link resolver index for this project (#2214).
 *
 * `buildLinkResolveCtx` used to rebuild this on every single-note save —
 * filtering and sorting all N paths, then building seven maps including one
 * entry per dash-segment of every stem. Measured at 1.4 / 3.1 / 10.5 / 19.2 ms
 * for 500 / 1,000 / 3,000 / 5,000 notes, paid by every save including one to a
 * note with no wiki-links at all.
 *
 * Cached against `version`, so it is rebuilt exactly when a path or a winning
 * alias changed. Returns the LIVE index; callers must not mutate it.
 */
export function wikiLinkIndex(ctx: ProjectContext): WikiLinkIndex {
  const idx = noteIndexStore.get(ctx);
  if (!idx) return EMPTY_LINK_INDEX;
  return ensureLinkIndex(idx);
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
