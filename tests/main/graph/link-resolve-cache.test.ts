/**
 * The wiki-link resolve index is cached, and invalidated by exactly the four
 * things that can change it (#2214).
 *
 * `buildLinkResolveCtx` used to rebuild the whole project-wide index on EVERY
 * single-note save: materialize every indexed path, `Object.fromEntries` the
 * alias map, then filter + sort all N files and build seven Maps (one
 * `bySuffixSlug` entry per dash-segment of every stem). Measured here, on a
 * fixture with realistic nested multi-word filenames, at 1.4 / 2.9 / 10.7 /
 * 18.4 ms for 500 / 1,000 / 3,000 / 5,000 notes — paid by every autosave tick,
 * including a save to a note with no wiki-links at all. `rebuildAliasMap` ran
 * a second O(N) pass on the same path. #1473 had hoisted the build out of the
 * BULK `indexAllNotes` walk; the incremental path still paid it in full.
 *
 * ── Why these tests are shaped like this ────────────────────────────────────
 * A cache has two failure modes and they pull in opposite directions, so each
 * gate here asserts BOTH halves:
 *
 *   - **It didn't actually cache.** Counted, not timed (#2229):
 *     `_derivationCountsForTests` records how many times each derivation was
 *     really recomputed, so "five saves, zero rebuilds" is a deterministic
 *     assertion rather than a stopwatch.
 *   - **It cached something wrong.** A count gate alone is satisfied just as
 *     well by an index that is never built and resolves nothing — so every
 *     count assertion below is paired with a resolution assertion, and every
 *     invalidation case checks the *new* answer, not merely that a rebuild
 *     happened.
 *
 * The invalidation cases are the ones that would ship as silent wrong answers:
 * a link to a note created seconds ago resolving to nothing, or a renamed note
 * still resolving to its old path.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { indexNote, indexAllNotes, removeNote, queryGraph, getAliasMap } from '../../../src/main/graph/index';
import { wikiLinkIndex, _derivationCountsForTests } from '../../../src/main/graph/note-index';
import { resolveWikiLinkTargetWithIndex } from '../../../src/shared/wiki-link-resolver';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';
import { useGraphProject } from '../../helpers/temp-project';

/** Snapshot the module-global derivation counters; `.since()` reads the delta. */
function counter() {
  const at = { ..._derivationCountsForTests };
  return {
    since: () => ({
      aliasMap: _derivationCountsForTests.aliasMap - at.aliasMap,
      linkIndex: _derivationCountsForTests.linkIndex - at.linkIndex,
    }),
  };
}

/** What a `[[target]]` in a note body resolves to — the production lookup, on
 *  whatever index the cache is currently serving. */
function resolves(ctx: ProjectContext, target: string): string | null {
  return resolveWikiLinkTargetWithIndex(target, wikiLinkIndex(ctx));
}

/** Outgoing `minerva:references` targets of every note, as path stems. */
async function referenceTargets(ctx: ProjectContext): Promise<string[]> {
  const r = await queryGraph(ctx, `
    SELECT ?target WHERE {
      ?subject <https://minerva.dev/ontology#references> ?target .
    }
  `);
  return (r.results as Array<{ target: string }>).map((row) => row.target);
}

describe('wiki-link resolve index — caching (#2214)', () => {
  const project = useGraphProject('minerva-link-resolve-cache-');
  let ctx: ProjectContext;

  beforeEach(async () => {
    ctx = project.ctx;
    await indexNote(ctx, 'notes/research/deep-ocean-currents.md', '# Deep ocean currents\n');
    await indexNote(ctx, 'notes/research/thermohaline-circulation.md', '# Thermohaline\n');
  });

  it('re-saving a known note with unchanged aliases rebuilds neither derivation', async () => {
    // Warm both derivations first, so the gate is about the SAVES, not about
    // whether anything was ever built.
    expect(resolves(ctx, 'deep-ocean-currents')).toBe('notes/research/deep-ocean-currents.md');

    const c = counter();
    for (let i = 0; i < 5; i++) {
      await indexNote(
        ctx,
        'notes/research/deep-ocean-currents.md',
        `# Deep ocean currents\n\nRevision ${i}. See [[thermohaline-circulation]].\n`,
      );
    }
    expect(c.since()).toEqual({ aliasMap: 0, linkIndex: 0 });

    // …and the index those saves resolved against is still the right one. A
    // count of zero is also what a never-built, resolves-nothing index scores.
    expect(resolves(ctx, 'thermohaline-circulation')).toBe('notes/research/thermohaline-circulation.md');
    expect(resolves(ctx, 'deep-ocean-currents')).toBe('notes/research/deep-ocean-currents.md');
    const targets = await referenceTargets(ctx);
    expect(targets.some((t) => t.endsWith('notes/research/thermohaline-circulation'))).toBe(true);
  });

  it('a save to a note with no wiki-links rebuilds nothing either', async () => {
    // The shape the issue singles out: the old code built the whole index
    // before discovering the note had no links to resolve.
    expect(resolves(ctx, 'deep-ocean-currents')).toBe('notes/research/deep-ocean-currents.md');
    const c = counter();
    await indexNote(ctx, 'notes/research/deep-ocean-currents.md', '# Deep ocean currents\n\nNo links.\n');
    expect(c.since()).toEqual({ aliasMap: 0, linkIndex: 0 });
  });

  it('a NEW note path invalidates — a link to it resolves on the very next save', async () => {
    expect(resolves(ctx, 'abyssal-plain-sediment')).toBeNull();

    await indexNote(ctx, 'notes/research/abyssal-plain-sediment.md', '# Abyssal plain sediment\n');
    expect(resolves(ctx, 'abyssal-plain-sediment')).toBe('notes/research/abyssal-plain-sediment.md');

    // End to end: a note linking to it lands the right target IRI, not the
    // `target.md` literal fallback a stale index would have produced.
    await indexNote(ctx, 'notes/essay.md', '# Essay\n\nSee [[abyssal-plain-sediment]].\n');
    const targets = await referenceTargets(ctx);
    expect(targets.some((t) => t.endsWith('notes/research/abyssal-plain-sediment'))).toBe(true);
  });

  it('removing a note invalidates — its path stops resolving', async () => {
    expect(resolves(ctx, 'thermohaline-circulation')).toBe('notes/research/thermohaline-circulation.md');

    removeNote(ctx, 'notes/research/thermohaline-circulation.md');
    expect(resolves(ctx, 'thermohaline-circulation')).toBeNull();
  });

  it('a rename resolves to the NEW path, not the old one', async () => {
    // The rename path is `removeNote(old)` + `indexNote(new)` — see
    // notebase/rename.ts. A stale index keeps answering with the old path,
    // which is the silent-wrong-answer case this cache could introduce.
    removeNote(ctx, 'notes/research/deep-ocean-currents.md');
    await indexNote(ctx, 'notes/oceanography/deep-ocean-currents.md', '# Deep ocean currents\n');

    expect(resolves(ctx, 'deep-ocean-currents')).toBe('notes/oceanography/deep-ocean-currents.md');
    expect(resolves(ctx, 'notes/research/deep-ocean-currents')).toBeNull();

    await indexNote(ctx, 'notes/essay.md', '# Essay\n\nSee [[deep-ocean-currents]].\n');
    const targets = await referenceTargets(ctx);
    expect(targets.some((t) => t.endsWith('notes/oceanography/deep-ocean-currents'))).toBe(true);
    expect(targets.every((t) => !t.endsWith('notes/research/deep-ocean-currents'))).toBe(true);
  });

  it('an ADDED frontmatter alias invalidates both derivations', async () => {
    expect(resolves(ctx, 'THC')).toBeNull();

    const c = counter();
    await indexNote(
      ctx,
      'notes/research/thermohaline-circulation.md',
      ['---', 'aliases:', '  - THC', '---', '# Thermohaline', ''].join('\n'),
    );
    // The alias map feeds the link index, so both had to be rederived.
    expect(c.since().aliasMap).toBeGreaterThan(0);

    expect(getAliasMap(ctx).thc).toBe('notes/research/thermohaline-circulation.md');
    expect(resolves(ctx, 'THC')).toBe('notes/research/thermohaline-circulation.md');
  });

  it('a REMOVED frontmatter alias invalidates — the alias stops resolving', async () => {
    await indexNote(
      ctx,
      'notes/research/thermohaline-circulation.md',
      ['---', 'aliases:', '  - THC', '---', '# Thermohaline', ''].join('\n'),
    );
    expect(resolves(ctx, 'THC')).toBe('notes/research/thermohaline-circulation.md');

    await indexNote(ctx, 'notes/research/thermohaline-circulation.md', '# Thermohaline\n');
    expect(getAliasMap(ctx).thc).toBeUndefined();
    expect(resolves(ctx, 'THC')).toBeNull();
  });

  it('re-saving a note whose aliases are unchanged does NOT invalidate', async () => {
    const body = ['---', 'aliases:', '  - THC', '---', '# Thermohaline', ''].join('\n');
    await indexNote(ctx, 'notes/research/thermohaline-circulation.md', body);
    expect(resolves(ctx, 'THC')).toBe('notes/research/thermohaline-circulation.md');

    const c = counter();
    await indexNote(ctx, 'notes/research/thermohaline-circulation.md', body);
    expect(c.since()).toEqual({ aliasMap: 0, linkIndex: 0 });
    expect(resolves(ctx, 'THC')).toBe('notes/research/thermohaline-circulation.md');
  });

  it('a from-scratch rebuild of an emptied thoughtbase resolves nothing', async () => {
    // `clearNoteIndex` is the fourth invalidation point, and the only one whose
    // bump is load-bearing on its own: the rebuild's pre-pass re-registers
    // every file it finds, which invalidates anyway — unless it finds none.
    // Delete every note while the app is closed, rebuild, and a cache that
    // trusted the pre-pass to invalidate still resolves the vanished notes.
    await fsp.writeFile(path.join(project.root, 'kelp-forest-canopy.md'), '# Kelp forest canopy\n', 'utf-8');
    await indexAllNotes(ctx);
    expect(resolves(ctx, 'kelp-forest-canopy')).toBe('kelp-forest-canopy.md');

    await fsp.rm(path.join(project.root, 'kelp-forest-canopy.md'));
    await indexAllNotes(ctx);
    expect(resolves(ctx, 'kelp-forest-canopy')).toBeNull();
  });

  it('a read for a never-indexed project neither builds nor allocates a slot', () => {
    // #2240: a read must not allocate a project slot, or a panel polling a
    // closed thoughtbase silently re-registers it. Two never-seen projects
    // getting the SAME index object is what proves nothing was allocated —
    // a per-project slot would have built one index each.
    const c = counter();
    const a = wikiLinkIndex(projectContext('/tmp/minerva-2214-never-seen-a'));
    const b = wikiLinkIndex(projectContext('/tmp/minerva-2214-never-seen-b'));
    expect(a).toBe(b);
    expect(resolveWikiLinkTargetWithIndex('anything', a)).toBeNull();
    expect(c.since()).toEqual({ aliasMap: 0, linkIndex: 0 });
  });
});
