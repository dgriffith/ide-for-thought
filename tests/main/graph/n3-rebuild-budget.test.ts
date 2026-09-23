/**
 * The N3 mirror's self-heal rebuild fires on a budget proportional to the
 * store, not a fixed count (#2212).
 *
 * `instrumentStoreMirror` keeps the N3 mirror in step with rdflib
 * incrementally, and counts its own mutations so that any unforeseen drift
 * self-heals with a periodic full rebuild. That counter used to be compared
 * against a flat 1,000.
 *
 * The problem was not the rebuild, it was the CADENCE. An ordinary save costs
 * a roughly constant number of mirror mutations regardless of project size —
 * measured at 20 for a five-link note at 400, 1,200 and 2,400 notes alike — so
 * a fixed budget fires every ~50 saves at every corpus size, while the rebuild
 * it triggers is O(total triples). Measured across 300 ordinary saves:
 *
 *     notes   quads     rebuilds (before → after)   amortized before
 *       400    8,328              6 → 0               1.09ms/save
 *     1,200   22,728              6 → 0               4.45ms/save
 *     2,400   44,328              6 → 0               2.37ms/save
 *
 * Six every time, at every size. The amortized column is noisy — it is
 * wall-clock on a loaded machine — which is exactly why the gates below count
 * rebuilds instead of timing them (#2229's scope note).
 *
 * What must not be lost is the backstop itself: the budget is bigger, not
 * absent, and a store that really does cross it still rebuilds. Both halves
 * are pinned here, because a fix that quietly disabled the self-heal would
 * look identical in a benchmark.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as $rdf from 'rdflib';
import { indexNote, queryGraph } from '../../../src/main/graph/index';
import { getState, ensureN3Cache, resetN3Mirror } from '../../../src/main/graph/state';
import { type ProjectContext } from '../../../src/main/project-context-types';
import { useGraphProject } from '../../helpers/temp-project';

/** The mirror's private bookkeeping, as the instrumentation writes it. */
const marker = (store: unknown) => store as { __minervaN3Writes?: number };

function note(i: number): string {
  const links = Array.from({ length: 5 }, (_, k) => `[[note-${i + k + 1}]]`).join(' ');
  return `---\ntitle: Note ${i}\ntags: [alpha, beta]\n---\n\n# Note ${i}\n\n${links}\n\n## S\n\nBody.\n`;
}

/**
 * Drive `n` mirror mutations directly, and report how many times the mirror
 * was dropped along the way.
 *
 * Going through `store.add` rather than `indexNote` keeps this a test of the
 * budget rather than of the indexer, and keeps it fast: the property is about
 * a count of mutations, and where they come from is irrelevant. (`store.add`
 * is the chokepoint every triple passes through — see #2231.)
 */
async function mutate(ctx: ProjectContext, n: number, tag: string): Promise<number> {
  const state = getState(ctx)!;
  await ensureN3Cache(state); // mirroring only counts while the mirror is live
  let rebuilds = 0;
  let prev = marker(state.store).__minervaN3Writes ?? 0;
  for (let i = 0; i < n; i++) {
    state.store.add(
      $rdf.sym(`https://minerva.dev/probe/${tag}/${i}`),
      $rdf.sym('https://minerva.dev/ontology#probe'),
      $rdf.literal(String(i)),
      $rdf.sym('https://minerva.dev/probe/g'),
    );
    const now = marker(state.store).__minervaN3Writes ?? 0;
    if (now < prev) {
      rebuilds += 1;
      await ensureN3Cache(state); // the cost the next query would pay
    }
    prev = marker(state.store).__minervaN3Writes ?? 0;
  }
  return rebuilds;
}

describe('the floor never binds on a real project (#2212)', () => {
  const project = useGraphProject('minerva-n3-budget-small-');

  it('a one-note project is already well past the floor — the ontology alone exceeds it', async () => {
    // Recorded because it was a surprise while writing these tests, and it
    // changes how `N3_REBUILD_FLOOR` should be read. `addOntologyToStore`
    // parses ~1,100 triples into every project's store at init, so the
    // SMALLEST possible thoughtbase is already above a 1,000 floor. The budget
    // is therefore always the store's own size in practice, and the floor is
    // only a lower bound for a store that somehow has neither notes nor
    // ontology — not a regime any real project passes through.
    //
    // If someone later "tidies" the floor upward to a few thousand on the
    // theory that it protects small projects, this test says what it actually
    // does.
    const ctx = project.ctx;
    await indexNote(ctx, 'notes/only.md', note(0));
    const state = getState(ctx)!;
    expect(
      state.store.statements.length,
      'the ontology no longer dominates a fresh store — re-read the floor comment',
    ).toBeGreaterThan(1000);
  });

  it('does not rebuild within the budget', async () => {
    const ctx = project.ctx;
    const state = getState(ctx)!;
    await ensureN3Cache(state);
    expect(await mutate(ctx, 900, 'under'), 'rebuilt inside the budget').toBe(0);
  });
});

describe('a larger store scales its budget (#2212)', () => {
  const project = useGraphProject('minerva-n3-budget-large-');
  let ctx: ProjectContext;

  beforeEach(async () => {
    ctx = project.ctx;
    for (let i = 0; i < 120; i++) await indexNote(ctx, `notes/note-${i}.md`, note(i));
  });

  it('absorbs the old fixed budget without a single rebuild', async () => {
    // The headline. 1,100 mutations is more than the old flat 1,000, so this
    // is precisely the case that used to force a full O(T) rebuild — and at
    // this size the budget is the store, which is larger.
    const state = getState(ctx)!;
    expect(state.store.statements.length, 'fixture is too small to test scaling')
      .toBeGreaterThan(1000);

    resetN3Mirror(state);
    expect(await mutate(ctx, 1_100, 'scaled'), 'the budget did not scale with the store').toBe(0);
  });

  it('rebuilds once its OWN budget is crossed', async () => {
    // Proportional, not disabled. Mutating past the store's own size must
    // still self-heal.
    const state = getState(ctx)!;
    const budget = state.store.statements.length;
    resetN3Mirror(state);
    expect(await mutate(ctx, budget + 200, 'over'), 'the scaled budget never fires')
      .toBeGreaterThanOrEqual(1);
  });

  it('the same work costs zero rebuilds at either corpus size', async () => {
    // The actual invariant behind the change: one O(T) rebuild per Θ(T)
    // mutations is O(1) amortized at ANY size. Counted, not timed — wall clock
    // on a shared machine says nothing and the count says everything.
    //
    // Written as "zero at both" rather than "not more at the bigger one",
    // which is what it said first and was too weak to fail: under the old flat
    // budget 1,100 mutations cost exactly one rebuild at EVERY size, so
    // `bigger <= smaller` held comfortably while the bug was fully present. A
    // relative assertion cannot catch a defect that is uniform across the
    // dimension being compared.
    const state = getState(ctx)!;
    resetN3Mirror(state);
    await ensureN3Cache(state);
    const atSize = await mutate(ctx, 1_100, 'cmpA');

    for (let i = 120; i < 240; i++) await indexNote(ctx, `notes/note-${i}.md`, note(i));
    resetN3Mirror(state);
    await ensureN3Cache(state);
    const atDoubleSize = await mutate(ctx, 1_100, 'cmpB');

    expect(state.store.statements.length).toBeGreaterThan(1000);
    expect(atSize, '1,100 mutations forced a rebuild at the smaller size').toBe(0);
    expect(atDoubleSize, '1,100 mutations forced a rebuild at the larger size').toBe(0);
  });
});

describe('the mirror still answers correctly across a rebuild', () => {
  const project = useGraphProject('minerva-n3-budget-correct-');

  it('a query after a forced rebuild sees every note', async () => {
    // The gates above count rebuilds, and a cache that returns nothing would
    // satisfy all of them. This is the assertion that stops that.
    const ctx = project.ctx;
    for (let i = 0; i < 25; i++) await indexNote(ctx, `notes/note-${i}.md`, note(i));

    const before = await queryGraph(ctx, 'SELECT ?s WHERE { ?s a minerva:Note }');
    expect(before.results.length).toBe(25);

    resetN3Mirror(getState(ctx)!);
    await ensureN3Cache(getState(ctx)!);

    const after = await queryGraph(ctx, 'SELECT ?s WHERE { ?s a minerva:Note }');
    expect(after.results.length, 'the rebuilt mirror lost notes').toBe(25);
  });

  it('an incrementally-mirrored write is visible without a rebuild', async () => {
    // The other direction: the budget increase means the mirror now goes much
    // longer between full rebuilds, so the incremental path is load-bearing
    // for longer. A note indexed with no rebuild in between must be queryable.
    const ctx = project.ctx;
    await ensureN3Cache(getState(ctx)!);
    const before = (await queryGraph(ctx, 'SELECT ?s WHERE { ?s a minerva:Note }')).results.length;

    await indexNote(ctx, 'notes/late-arrival.md', note(999));

    const after = await queryGraph(ctx, 'SELECT ?s WHERE { ?s a minerva:Note }');
    expect(after.results.length, 'an incremental write never reached the mirror')
      .toBe(before + 1);
  });
});
