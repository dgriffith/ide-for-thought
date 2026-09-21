/**
 * Derived per-note caches, split out of `GraphState` (#2234, epic #2241).
 *
 * `GraphState` was an open mutable twelve-field record with no methods,
 * bundling eight responsibilities. Four of them are not graph state at all:
 * they are UI-feature caches that live there only because the indexer walk
 * already has each note's parsed content in hand, so populating them was free.
 * They have no reason to share a lifetime — or a mutation path — with the
 * triple store:
 *
 *   - **headings** — a snapshot per note, for the rename-detection heuristic;
 *   - **frontmatter keys** — what the Properties panel's autocomplete offers;
 *   - **neighborhood** — an LRU memo of `neighborhood()` BFS results.
 *
 * (The fourth, the wiki-link alias index, is a genuinely coupled trio —
 * `aliasMap`/`aliasesPerNote`/`indexedNotePaths` are maintained together by
 * `rebuildAliasMap` — and moves separately.)
 *
 * They sit in their own `createProjectStore` slot with the same per-project
 * lifecycle every other subsystem uses, which is what makes them droppable and
 * clearable without reaching into the graph's mutable record.
 *
 * What this deliberately is NOT: a "manager class" wrapping the same fields
 * under a new name. The point is that these three caches are a separate
 * concern with a separate lifetime, not that twelve fields should become an
 * object with twelve accessors (#2234's own "what not to do").
 */
import type { ProjectContext } from '../project-context-types';
import type { NeighborhoodResult } from '../../shared/types';
import { createProjectStore } from '../project-store';

/** One heading as the indexer last saw it, for rename detection. */
export interface HeadingSnapshot {
  slug: string;
  text: string;
  level: number;
}

interface NoteCaches {
  /** Heading snapshot per note for the rename-detection heuristic. */
  headings: Map<string, HeadingSnapshot[]>;
  /**
   * Frontmatter keys present on each indexed note. Powers the Properties
   * panel's project-wide key autocomplete (#488) — the graph already extracts
   * frontmatter on every index, so capturing the bare key list is essentially
   * free. Kept as a `string[]` per note (rather than a flat global Set) so
   * `removeNote` can shrink the union without scanning every note.
   */
  frontmatterKeys: Map<string, string[]>;
  /**
   * Memoized `neighborhood()` results keyed by `path\0depth\0cap` (perf #1113).
   * The graph/citations panels re-run a neighborhood BFS on every note switch
   * via a reactive `$effect`, and a build hops up to `cap` nodes × (outgoing +
   * backlink) predicate fans — so re-selecting a note used to redo the whole
   * traversal. A small LRU (bounded in `neighborhood()`) keeps back-and-forth
   * navigation off the BFS. Cleared wholesale by `invalidate()` on every write,
   * the same coarse always-correct invalidation `n3Cache` uses: any triple
   * change can alter some note's link neighborhood, so a targeted eviction
   * would be both fiddly and easy to get subtly wrong.
   */
  neighborhood: Map<string, NeighborhoodResult>;
}

const noteCacheStore = createProjectStore<NoteCaches>();

/**
 * This project's caches, created on first use.
 *
 * Lazy rather than initialized alongside the graph, because that's what makes
 * them independent: a caller that only wants a heading snapshot no longer has
 * to care whether `initGraph` ran. The read helpers below still answer
 * emptily for a project with no graph, matching their previous behaviour.
 */
function caches(ctx: ProjectContext): NoteCaches {
  const existing = noteCacheStore.get(ctx);
  if (existing) return existing;
  const fresh: NoteCaches = {
    headings: new Map(),
    frontmatterKeys: new Map(),
    neighborhood: new Map(),
  };
  noteCacheStore.set(ctx, fresh);
  return fresh;
}

// ── Headings (rename detection) ─────────────────────────────────────────────

/** Headings present in the last `indexNote` for `relativePath`, or []. */
export function getHeadings(ctx: ProjectContext, relativePath: string): HeadingSnapshot[] {
  return noteCacheStore.get(ctx)?.headings.get(relativePath) ?? [];
}

export function setHeadings(ctx: ProjectContext, relativePath: string, headings: HeadingSnapshot[]): void {
  caches(ctx).headings.set(relativePath, headings);
}

// ── Frontmatter keys (Properties autocomplete) ──────────────────────────────

export function setFrontmatterKeys(ctx: ProjectContext, relativePath: string, keys: string[]): void {
  caches(ctx).frontmatterKeys.set(relativePath, keys);
}

/** Every frontmatter key in use across the project, sorted. Empty when the
 *  project has nothing indexed yet. */
export function allFrontmatterKeys(ctx: ProjectContext): string[] {
  const store = noteCacheStore.get(ctx);
  if (!store) return [];
  const seen = new Set<string>();
  for (const keys of store.frontmatterKeys.values()) for (const k of keys) seen.add(k);
  return [...seen].sort((a, b) => a.localeCompare(b));
}

// ── Neighborhood LRU ────────────────────────────────────────────────────────

/** The memo map itself — `neighborhood()` owns the LRU policy (bounding and
 *  recency-refresh), so it needs the map rather than get/set wrappers that
 *  would hide the delete-then-set recency move. */
export function neighborhoodCache(ctx: ProjectContext): Map<string, NeighborhoodResult> {
  return caches(ctx).neighborhood;
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

/** Drop a note's cached derivations — `removeNote`'s half of the bookkeeping. */
export function forgetNote(ctx: ProjectContext, relativePath: string): void {
  const store = noteCacheStore.get(ctx);
  if (!store) return;
  store.headings.delete(relativePath);
  store.frontmatterKeys.delete(relativePath);
}

/** Clear the neighborhood memo. Called by `invalidate()` on every graph write —
 *  any triple change can alter some note's link neighborhood. */
export function clearNeighborhoodCache(ctx: ProjectContext): void {
  noteCacheStore.get(ctx)?.neighborhood.clear();
}

/** Drop every cache for a project. Used by the full-rebuild path, which
 *  re-derives all of them from the files. */
export function clearNoteCaches(ctx: ProjectContext): void {
  const store = noteCacheStore.get(ctx);
  if (!store) return;
  store.headings.clear();
  store.frontmatterKeys.clear();
  store.neighborhood.clear();
}
