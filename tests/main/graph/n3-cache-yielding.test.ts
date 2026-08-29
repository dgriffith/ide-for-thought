/**
 * Yielding cold N3 rebuild (#1115 down-payment).
 *
 * `ensureN3Cache` builds the mirror from a synchronous snapshot, time-slicing
 * with `setImmediate` yields so a large cold rebuild doesn't block the main
 * thread. The safety property is concurrency: a write that interleaves during a
 * yield must NOT corrupt the result — the build detects the raced mutation and
 * falls back to the atomic synchronous rebuild, so the mirror still equals a
 * from-scratch `buildN3Store` of the final rdflib state.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type * as N3 from 'n3';
import * as $rdf from 'rdflib';
import { indexNote } from '../../../src/main/graph/index';
import { buildN3Store, ensureN3Cache, getState, resetN3Mirror, RDF, MINERVA } from '../../../src/main/graph/state';
import { type ProjectContext } from '../../../src/main/project-context-types';
import { useGraphProject } from '../../helpers/temp-project';

function tripleSet(store: N3.Store): Set<string> {
  const keys = new Set<string>();
  for (const q of store.getQuads(null, null, null, null)) {
    const o = q.object;
    const oKey = o.termType === 'Literal'
      ? `L${o.value}${o.datatype?.value ?? ''}`
      : `${o.termType}${o.value}`;
    keys.add(`${q.subject.value}${q.predicate.value}${oKey}`);
  }
  return keys;
}

describe('ensureN3Cache — yielding cold rebuild (#1115)', () => {
  const project = useGraphProject('minerva-n3yield-');
  let ctx: ProjectContext;

  beforeEach(() => {
    ctx = project.ctx;
  });

  it('builds a mirror equal to the synchronous buildN3Store', async () => {
    await indexNote(ctx, 'a.md', '---\ntitle: A\ntags: [x]\n---\n# A\n\n[[b]]\n');
    await indexNote(ctx, 'b.md', '---\ntitle: B\n---\n# B\n');
    const state = getState(ctx)!;
    const mirror = await ensureN3Cache(state);
    expect([...tripleSet(mirror)].sort()).toEqual([...tripleSet(buildN3Store(state.store))].sort());
  });

  it('returns the same live instance on a warm call (no rebuild)', async () => {
    await indexNote(ctx, 'a.md', '---\ntitle: A\n---\n# A\n');
    const state = getState(ctx)!;
    const first = await ensureN3Cache(state);
    const second = await ensureN3Cache(state);
    expect(second).toBe(first);
  });

  it('a write that races the async build is reflected (falls back to the atomic rebuild)', async () => {
    // Seed enough triples that the build spans several yields, so a write
    // injected via setImmediate lands *mid-build*.
    const state = getState(ctx)!;
    const g = $rdf.sym('urn:seed');
    for (let i = 0; i < 60000; i++) {
      state.store.add($rdf.sym(`urn:s${i}`), RDF('type'), MINERVA('Seed'), g);
    }
    resetN3Mirror(state); // ensure cold (n3Cache null) so ensureN3Cache rebuilds

    const racedSubject = $rdf.sym('urn:raced-in');
    const p = ensureN3Cache(state); // runs slice 1 synchronously, then yields
    // Scheduled after the build's first-slice setImmediate → runs during a yield.
    await new Promise<void>((resolve) => setImmediate(() => {
      state.store.add(racedSubject, RDF('type'), MINERVA('Raced'), g);
      resolve();
    }));
    const mirror = await p;

    // The raced write must be present, and the mirror must equal a fresh rebuild
    // of the final rdflib state (i.e. the fallback produced a consistent result).
    const key = `urn:raced-in${RDF('type').value}NamedNode${MINERVA('Raced').value}`;
    expect(tripleSet(mirror).has(key)).toBe(true);
    expect([...tripleSet(mirror)].sort()).toEqual([...tripleSet(buildN3Store(state.store))].sort());
  });
});
