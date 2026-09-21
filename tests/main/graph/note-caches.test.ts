/**
 * The derived per-note caches, after their split out of `GraphState` (#2234).
 *
 * Three of `GraphState`'s twelve fields were UI-feature caches that lived there
 * only because the indexer walk already had each note's parsed content in hand.
 * They now sit in their own `createProjectStore` slot. What that has to buy,
 * and what these cases check:
 *
 *   - **per-project isolation** — the old `Map`s hung off one project's state
 *     record, so isolation came free; a shared module-level store has to earn
 *     it, and getting it wrong would leak one thoughtbase's headings into
 *     another's rename detection;
 *   - **the same emptiness contract** — `headingsFor` / `getAllFrontmatterKeys`
 *     answered `[]` for a project with no graph, and callers depend on that;
 *   - **the lifecycle hooks** the graph still drives: `forgetNote` on removal,
 *     `clearNeighborhoodCache` on every write, `clearNoteCaches` on rebuild.
 *
 * The integration — that `indexNote` actually populates these, and that a
 * heading rename is still detected across two indexes — is covered by
 * `heading-rename.test.ts` and `frontmatter-indexing.test.ts` against the real
 * indexer. This file tests the store itself.
 */
import { describe, it, expect } from 'vitest';
import {
  getHeadings,
  setHeadings,
  setFrontmatterKeys,
  allFrontmatterKeys,
  neighborhoodCache,
  forgetNote,
  clearNeighborhoodCache,
  clearNoteCaches,
} from '../../../src/main/graph/note-caches';
import { projectContext } from '../../../src/main/project-context-types';
import type { NeighborhoodResult } from '../../../src/shared/types';

/** Distinct rootPaths per case — the store is module-level and keyed by them. */
let n = 0;
const freshCtx = () => projectContext(`/tmp/minerva-note-caches-${n++}`);

const heading = (slug: string) => ({ slug, text: slug, level: 1 });
const emptyNeighborhood = { nodes: [], edges: [] } as unknown as NeighborhoodResult;

describe('note caches — headings', () => {
  it('round-trips a snapshot', () => {
    const ctx = freshCtx();
    setHeadings(ctx, 'a.md', [heading('intro')]);
    expect(getHeadings(ctx, 'a.md')).toEqual([heading('intro')]);
  });

  it('answers [] for an unknown note and for a project with no caches at all', () => {
    // `headingsFor` promised this before the split and `indexNote` relies on
    // it: an empty snapshot means "never indexed", which is what suppresses a
    // spurious heading-rename prompt on a note's first index.
    const ctx = freshCtx();
    expect(getHeadings(ctx, 'never-indexed.md')).toEqual([]);
    setHeadings(ctx, 'other.md', [heading('x')]);
    expect(getHeadings(ctx, 'never-indexed.md')).toEqual([]);
  });

  it('keeps projects apart', () => {
    const a = freshCtx();
    const b = freshCtx();
    setHeadings(a, 'note.md', [heading('from-a')]);
    setHeadings(b, 'note.md', [heading('from-b')]);
    expect(getHeadings(a, 'note.md')).toEqual([heading('from-a')]);
    expect(getHeadings(b, 'note.md')).toEqual([heading('from-b')]);
  });
});

describe('note caches — frontmatter keys', () => {
  it('unions across notes, sorted, de-duplicated', () => {
    const ctx = freshCtx();
    setFrontmatterKeys(ctx, 'a.md', ['title', 'tags']);
    setFrontmatterKeys(ctx, 'b.md', ['tags', 'author']);
    expect(allFrontmatterKeys(ctx)).toEqual(['author', 'tags', 'title']);
  });

  it('answers [] for a project with nothing indexed', () => {
    expect(allFrontmatterKeys(freshCtx())).toEqual([]);
  });

  it('shrinks the union when a note is forgotten', () => {
    // The reason this is a Map<note, keys[]> rather than one flat Set: removing
    // a note has to be able to drop the keys only it contributed, without
    // rescanning every other note.
    const ctx = freshCtx();
    setFrontmatterKeys(ctx, 'a.md', ['title', 'rating']);
    setFrontmatterKeys(ctx, 'b.md', ['title']);
    forgetNote(ctx, 'a.md');
    expect(allFrontmatterKeys(ctx)).toEqual(['title']);
  });

  it('keeps projects apart', () => {
    const a = freshCtx();
    const b = freshCtx();
    setFrontmatterKeys(a, 'n.md', ['only-in-a']);
    setFrontmatterKeys(b, 'n.md', ['only-in-b']);
    expect(allFrontmatterKeys(a)).toEqual(['only-in-a']);
    expect(allFrontmatterKeys(b)).toEqual(['only-in-b']);
  });
});

describe('note caches — neighborhood memo', () => {
  it('hands back a live map so neighborhood() can own its LRU policy', () => {
    // Deliberately the map, not get/set wrappers: the recency refresh is a
    // delete-then-set, which wrappers would hide.
    const ctx = freshCtx();
    neighborhoodCache(ctx).set('k', emptyNeighborhood);
    expect(neighborhoodCache(ctx).get('k')).toBe(emptyNeighborhood);
  });

  it('is cleared wholesale on a graph write', () => {
    const ctx = freshCtx();
    neighborhoodCache(ctx).set('k', emptyNeighborhood);
    clearNeighborhoodCache(ctx);
    expect(neighborhoodCache(ctx).size).toBe(0);
  });

  it('clearing one project leaves another alone', () => {
    const a = freshCtx();
    const b = freshCtx();
    neighborhoodCache(a).set('k', emptyNeighborhood);
    neighborhoodCache(b).set('k', emptyNeighborhood);
    clearNeighborhoodCache(a);
    expect(neighborhoodCache(a).size).toBe(0);
    expect(neighborhoodCache(b).size).toBe(1);
  });
});

describe('note caches — lifecycle hooks are no-ops on an untouched project', () => {
  it('forgetNote / clearNeighborhoodCache / clearNoteCaches do not throw or create state', () => {
    // `invalidate()` runs on every graph write, including writes to a project
    // whose caches nobody has populated yet — so these must tolerate a missing
    // slot rather than eagerly creating one.
    const ctx = freshCtx();
    expect(() => forgetNote(ctx, 'nope.md')).not.toThrow();
    expect(() => clearNeighborhoodCache(ctx)).not.toThrow();
    expect(() => clearNoteCaches(ctx)).not.toThrow();
    expect(getHeadings(ctx, 'nope.md')).toEqual([]);
    expect(allFrontmatterKeys(ctx)).toEqual([]);
  });

  it('clearNoteCaches drops all three at once — the full-rebuild path', () => {
    const ctx = freshCtx();
    setHeadings(ctx, 'a.md', [heading('h')]);
    setFrontmatterKeys(ctx, 'a.md', ['title']);
    neighborhoodCache(ctx).set('k', emptyNeighborhood);

    clearNoteCaches(ctx);

    expect(getHeadings(ctx, 'a.md')).toEqual([]);
    expect(allFrontmatterKeys(ctx)).toEqual([]);
    expect(neighborhoodCache(ctx).size).toBe(0);
  });
});
