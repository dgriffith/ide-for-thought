/**
 * The staleness check reports the OLDEST stale notes, not an arbitrary sample
 * (#2208).
 *
 * `ORDER BY ?modified LIMIT n` is evaluated order-then-limit, so Comunica sorts
 * every matching row before discarding almost all of it. In a mature
 * thoughtbase the staleness filter matches nearly every note, so that is the
 * whole corpus: 546ms at 1,000 stale notes, 1,064ms at 3,000.
 *
 * The check is now two queries — sort a two-variable projection, then fetch
 * details for the surviving IRIs — which is 4.3-9.9× faster end to end on
 * `runAllChecks` (1,471ms → 149ms at 5,000 notes, measured locally before and
 * after on the same machine).
 *
 * This file exists because the FAST version of this change is not the correct
 * one, and the difference is invisible in a benchmark. Dropping `ORDER BY` and
 * keeping the `LIMIT` measures 63ms against 546ms — by far the best number
 * available — and quietly changes which notes the user is shown from "the
 * oldest n" to "whichever n the join happened to emit first". These tests are
 * what makes that trade visible: they fail for the fast-and-wrong version and
 * pass for the fast-and-right one.
 *
 * (Sorting in JS instead, the fix the issue proposes, was measured at 605ms —
 * slower than the ORDER BY it replaces, because the cost is carrying four bound
 * variables per row, not the comparison.)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { indexNote } from '../../../src/main/graph/index';
import { runAllChecks } from '../../../src/main/graph/health-checks';
import { DEFAULT_INSPECTION_SETTINGS } from '../../../src/shared/inspections';
import { type ProjectContext } from '../../../src/main/project-context-types';
import { useGraphProject } from '../../helpers/temp-project';

const DAY = 86_400_000;

/** A note last modified `age` days ago. */
async function stale(ctx: ProjectContext, name: string, ageDays: number): Promise<void> {
  const modified = new Date(Date.now() - ageDays * DAY).toISOString();
  await indexNote(ctx, `notes/${name}.md`, `---\ntitle: ${name}\nmodified: ${modified}\n---\n\n# ${name}\n`);
}

const staleOnly = { ...DEFAULT_INSPECTION_SETTINGS, staleDays: 30 };

describe('staleness selection (#2208)', () => {
  const project = useGraphProject('minerva-staleness-selection-');
  let ctx: ProjectContext;

  beforeEach(() => { ctx = project.ctx; });

  it('reports a stale note and ignores a fresh one', async () => {
    await stale(ctx, 'ancient', 400);
    await stale(ctx, 'yesterday', 1);

    const found = (await runAllChecks(ctx, staleOnly)).filter((i) => i.type === 'stale_note');
    expect(found.map((i) => i.nodeLabel)).toEqual(['ancient']);
  });

  it('picks the OLDEST when more notes are stale than the limit reports', async () => {
    // The assertion that separates the correct fix from the fast one. The
    // limit is 20, so 30 stale notes force a choice; ages are assigned so the
    // oldest 20 are a known set. A version that drops ORDER BY returns
    // whichever 20 the join emitted first and fails here.
    for (let i = 0; i < 30; i++) await stale(ctx, `n${String(i).padStart(2, '0')}`, 100 + i);

    const found = (await runAllChecks(ctx, staleOnly)).filter((i) => i.type === 'stale_note');
    expect(found.length).toBe(20);

    // Ages increase with the index, so the oldest 20 are n29 down to n10.
    const reported = new Set(found.map((i) => i.nodeLabel));
    for (let i = 10; i < 30; i++) {
      expect(reported.has(`n${String(i).padStart(2, '0')}`), `expected the oldest set to include n${i}`).toBe(true);
    }
    // And the freshest ten must NOT appear, which is the half a "first n"
    // implementation gets wrong.
    for (let i = 0; i < 10; i++) {
      expect(reported.has(`n${String(i).padStart(2, '0')}`), `n${i} is not among the oldest 20`).toBe(false);
    }
  });

  it('reports each stale note once, however many titles it carries', async () => {
    // The detail fetch is bounded by IRIs rather than by a LIMIT, so a note
    // with duplicate `dc:title`/`relativePath` triples multiplies its rows
    // instead of being silently truncated — the probe for this returned 200
    // rows for 100 notes. Hence SELECT DISTINCT.
    await stale(ctx, 'solo', 200);
    const found = (await runAllChecks(ctx, staleOnly)).filter((i) => i.type === 'stale_note');
    expect(found.filter((i) => i.nodeLabel === 'solo')).toHaveLength(1);
  });

  it('returns nothing, and asks nothing further, when no note is stale', async () => {
    // The two-phase shape has an early exit: no IRIs means the detail query is
    // never issued. Worth pinning so it isn't "optimised" into always running.
    await stale(ctx, 'fresh', 2);
    const found = (await runAllChecks(ctx, staleOnly)).filter((i) => i.type === 'stale_note');
    expect(found).toEqual([]);
  });

  it('honours a raised threshold', async () => {
    // Guards against the cutoff being dropped from the first phase — where it
    // now lives — while the second phase keeps looking correct.
    await stale(ctx, 'sixty', 60);
    const at30 = (await runAllChecks(ctx, staleOnly)).filter((i) => i.type === 'stale_note');
    expect(at30.map((i) => i.nodeLabel)).toEqual(['sixty']);

    const at90 = (await runAllChecks(ctx, { ...DEFAULT_INSPECTION_SETTINGS, staleDays: 90 }))
      .filter((i) => i.type === 'stale_note');
    expect(at90).toEqual([]);
  });
});
