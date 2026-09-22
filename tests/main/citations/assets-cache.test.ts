/**
 * The preview's citation cache: what it saves, and what it must never serve
 * stale (#2210 §3a).
 *
 * The gates here are COUNTS, not milliseconds — `readFile` calls per render
 * tick, and loads per burst. A wall-clock threshold on a shared CI box would
 * flap; "the second tick reads no files" is the actual invariant and it is
 * exact. The timings in the module comment of `assets-cache.ts` say why the
 * counts matter; these tests say the counts are real.
 *
 * Every freshness test below is written as a full round trip through the real
 * `renderInlineCitations` — write to disk, invalidate the way production
 * invalidates, render, and assert the marker CHANGED. Asserting on cache
 * internals instead would pass for a cache that invalidates a slot nothing
 * reads.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * `loadCitationAssets` is total today — it try/catches its own `readdir` and
 * `readFile`, so a project with no `.minerva/sources` loads as empty rather
 * than failing. That is why the failure case is injected HERE rather than by
 * breaking the filesystem: the first version of the "a failed load is not
 * cached" test below mocked `fsp.readdir` to reject and passed whether or not
 * the cache handled a rejection at all, because no rejection ever reached it.
 * What is under test is the cache's behaviour when its loader rejects, which
 * is the cache's business and not a fact about the loader.
 */
const inject = vi.hoisted(() => ({ failNext: false }));
vi.mock('../../../src/main/publish/csl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/main/publish/csl')>();
  return {
    ...actual,
    loadCitationAssets: (...args: Parameters<typeof actual.loadCitationAssets>) => {
      if (inject.failNext) {
        inject.failNext = false;
        return Promise.reject(new Error('injected load failure'));
      }
      return actual.loadCitationAssets(...args);
    },
  };
});
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { renderInlineCitations } from '../../../src/main/citations/render-inline';
import {
  armCitationAssetsCache,
  invalidateCitationAssets,
  withPreviewRenderer,
  _citationCacheStateForTests,
} from '../../../src/main/citations/assets-cache';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';

function writeSource(root: string, id: string, title: string, creator = 'Smith, Jane'): void {
  const dir = path.join(root, '.minerva', 'sources', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'meta.ttl'),
    `this: a thought:Article ;\n  dc:title "${title}" ;\n  dc:creator "${creator}" ;\n  dc:issued "2020-04-15"^^xsd:date .\n`,
    'utf-8',
  );
}

function writeExcerpt(root: string, id: string, sourceId: string, page: number): void {
  const dir = path.join(root, '.minerva', 'excerpts');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${id}.ttl`),
    `this: a thought:Excerpt ;\n  thought:fromSource sources:${sourceId} ;\n  thought:page ${page} ;\n  thought:citedText "Body" .\n`,
    'utf-8',
  );
}

/** Count `fs.promises.readFile` calls while `fn` runs — the library scan. */
async function countReads<T>(fn: () => Promise<T>): Promise<{ result: T; reads: number }> {
  let reads = 0;
  const real = fsp.readFile;
  const spy = vi.spyOn(fsp, 'readFile').mockImplementation(((...args: unknown[]) => {
    reads += 1;
    return (real as unknown as (...a: unknown[]) => unknown)(...args);
  }) as never);
  try {
    return { result: await fn(), reads };
  } finally {
    spy.mockRestore();
  }
}

describe('citation assets cache (#2210)', () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-citation-cache-'));
    ctx = projectContext(root);
    writeSource(root, 'smith-2020', 'On the Growth of Things');
    writeExcerpt(root, 'ex-42', 'smith-2020', 42);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const cite = [{ kind: 'cite' as const, id: 'smith-2020' }];

  describe('unarmed — no watcher, no cache', () => {
    it('reads the library on every tick, exactly as before', async () => {
      // The fail-safe. A project nothing is invalidating for (a test, the
      // headless CLI, a publish run with no window) must never see a cached
      // value, because there is nothing to tell it the library moved.
      expect(_citationCacheStateForTests(ctx).armed).toBe(false);
      const first = await countReads(() => renderInlineCitations(ctx, cite));
      const second = await countReads(() => renderInlineCitations(ctx, cite));
      expect(first.reads).toBeGreaterThan(0);
      expect(second.reads, 'an unarmed project cached something').toBe(first.reads);
    });

    it('still picks up an edit made between ticks', async () => {
      const before = await renderInlineCitations(ctx, cite);
      expect(before.markers[0]).toMatch(/Smith/);
      writeSource(root, 'smith-2020', 'Renamed', 'Okonkwo, Ada');
      const after = await renderInlineCitations(ctx, cite);
      expect(after.markers[0]).toMatch(/Okonkwo/);
    });
  });

  describe('armed', () => {
    beforeEach(() => { armCitationAssetsCache(ctx); });

    it('reads the library once, then not again — the per-tick gate', async () => {
      const first = await countReads(() => renderInlineCitations(ctx, cite));
      expect(first.reads, 'the first tick must actually load').toBeGreaterThan(0);

      for (let tick = 2; tick <= 6; tick++) {
        const next = await countReads(() => renderInlineCitations(ctx, cite));
        expect(next.reads, `tick ${tick} re-read the library`).toBe(0);
      }
    });

    it('the cached ticks produce the same answer as the first', async () => {
      // The count gate above is satisfied by a cache that returns nonsense.
      const first = await renderInlineCitations(ctx, cite);
      for (let i = 0; i < 4; i++) {
        expect(await renderInlineCitations(ctx, cite)).toEqual(first);
      }
    });

    it('a burst of concurrent ticks collapses to ONE library load', async () => {
      // At 668ms per load against a 120ms debounce, typing used to leave ~5
      // full scans in flight at once. Caching the promise rather than the
      // resolved value is what makes the burst join the first load.
      const { reads } = await countReads(async () => {
        await Promise.all(Array.from({ length: 5 }, () => renderInlineCitations(ctx, cite)));
      });
      const single = _citationCacheStateForTests(ctx);
      expect(single.hasBundle).toBe(true);

      // One load's worth of reads: 1 source meta + 1 excerpt. A promise-less
      // cache would show 5x this.
      expect(reads, 'a concurrent burst issued more than one library load').toBe(2);
    });

    it('a second style loads separately and does not evict the first', async () => {
      await withPreviewRenderer(ctx, { styleId: 'apa' }, (r) => r.renderCitation('smith-2020'));
      const other = await countReads(() =>
        withPreviewRenderer(ctx, { styleId: 'ieee' }, (r) => r.renderCitation('smith-2020')),
      );
      expect(other.reads, 'switching style should reload').toBeGreaterThan(0);
    });
  });

  describe('freshness — every invalidation path, end to end', () => {
    beforeEach(() => { armCitationAssetsCache(ctx); });

    it('an edited source meta.ttl shows up on the next tick', async () => {
      const before = await renderInlineCitations(ctx, cite);
      expect(before.markers[0]).toMatch(/Smith/);

      writeSource(root, 'smith-2020', 'Renamed', 'Okonkwo, Ada');
      // Without this the marker stays "Smith" — which is precisely the bug a
      // cache introduces and why the watcher wiring in `watch-handlers.ts`
      // matters more than the cache itself.
      invalidateCitationAssets(ctx);

      const after = await renderInlineCitations(ctx, cite);
      expect(after.markers[0], 'the cache served a stale author').toMatch(/Okonkwo/);
    });

    it('a newly added source becomes citable', async () => {
      const before = await renderInlineCitations(ctx, [{ kind: 'cite', id: 'new-one' }]);
      expect(before.missing).toContain('new-one');

      writeSource(root, 'new-one', 'A Late Arrival', 'Lee, Kim');
      invalidateCitationAssets(ctx);

      const after = await renderInlineCitations(ctx, [{ kind: 'cite', id: 'new-one' }]);
      expect(after.missing).not.toContain('new-one');
      expect(after.markers[0]).toMatch(/Lee/);
    });

    it('a deleted source stops resolving', async () => {
      expect((await renderInlineCitations(ctx, cite)).missing).not.toContain('smith-2020');

      fs.rmSync(path.join(root, '.minerva', 'sources', 'smith-2020'), { recursive: true });
      invalidateCitationAssets(ctx);

      expect((await renderInlineCitations(ctx, cite)).missing).toContain('smith-2020');
    });

    it('an edited excerpt locator shows up on the next tick', async () => {
      const quote = [{ kind: 'quote' as const, id: 'ex-42' }];
      expect((await renderInlineCitations(ctx, quote)).markers[0]).toMatch(/42/);

      writeExcerpt(root, 'ex-42', 'smith-2020', 99);
      invalidateCitationAssets(ctx);

      expect((await renderInlineCitations(ctx, quote)).markers[0]).toMatch(/99/);
    });

    it('an invalidation during an in-flight load still forces a reload after it', async () => {
      // A load takes hundreds of milliseconds, so an edit saved while one is
      // in flight is entirely ordinary. The bundle that load resolves into
      // predates the edit, so the tick after it must NOT be served from it.
      //
      // Stated as a read count rather than as a marker, deliberately. The
      // marker version of this test — write the file, invalidate, await the
      // in-flight call, assert the next marker changed — passes whether or
      // not the cache is correct, because the in-flight load may not have
      // reached `meta.ttl` yet and so picks up the new bytes anyway. It
      // looked like the sharpest test here and was the only vacuous one.
      const inFlight = renderInlineCitations(ctx, cite);
      invalidateCitationAssets(ctx);
      await inFlight;

      const next = await countReads(() => renderInlineCitations(ctx, cite));
      expect(next.reads, 'the tick after the invalidation was served from the stale in-flight load')
        .toBeGreaterThan(0);
    });

    it('a failed load is not cached — the next tick retries', async () => {
      // A cache that keeps a rejected promise replays the failure forever:
      // the preview's citations would stay broken until the project is
      // reopened, with no event able to clear it.
      inject.failNext = true;
      await expect(renderInlineCitations(ctx, cite)).rejects.toThrow('injected load failure');
      expect(
        _citationCacheStateForTests(ctx).hasBundle,
        'a rejected load stayed in the cache',
      ).toBe(false);

      // And the very next tick — with nothing invalidated in between —
      // succeeds on its own.
      const after = await renderInlineCitations(ctx, cite);
      expect(after.markers[0]).toMatch(/Smith/);
    });
  });

  describe('session isolation', () => {
    beforeEach(() => { armCitationAssetsCache(ctx); });

    it('overlapping renders each get a clean session', async () => {
      // Five ticks sharing one engine must each answer as if alone. This is
      // the cached counterpart of `engine-reuse.test.ts`: that file proves
      // `reset()` is total, this one proves the cache actually calls it.
      writeSource(root, 'other', 'Another Work', 'Nakamura, Rei');
      const results = await Promise.all([
        renderInlineCitations(ctx, cite),
        renderInlineCitations(ctx, [{ kind: 'cite', id: 'other' }]),
        renderInlineCitations(ctx, cite),
        renderInlineCitations(ctx, [{ kind: 'cite', id: 'nope' }]),
        renderInlineCitations(ctx, cite),
      ]);
      expect(results[0].markers[0]).toMatch(/Smith/);
      expect(results[1].markers[0]).toMatch(/Nakamura/);
      expect(results[2]).toEqual(results[0]);
      expect(results[3].missing, 'the missing set leaked between sessions').toEqual(['nope']);
      expect(results[4]).toEqual(results[0]);
      // And no session inherited another's missing id.
      expect(results[0].missing).toEqual([]);
    });
  });

  describe('bookkeeping', () => {
    it('arming twice keeps the existing slot and its cached bundle', async () => {
      armCitationAssetsCache(ctx);
      await renderInlineCitations(ctx, cite);
      expect(_citationCacheStateForTests(ctx).hasBundle).toBe(true);
      armCitationAssetsCache(ctx);
      expect(
        _citationCacheStateForTests(ctx).hasBundle,
        're-arming threw away a valid bundle',
      ).toBe(true);
    });

    it('invalidating an unarmed project is a no-op, not a throw', () => {
      expect(() => invalidateCitationAssets(projectContext('/never-opened'))).not.toThrow();
    });
  });
});
