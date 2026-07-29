/**
 * Incremental N3 mirror equivalence (#1110).
 *
 * The N3.Store mirror is now maintained incrementally on every write instead of
 * nulled-and-rebuilt (state.ts `instrumentStoreMirror`). The one failure mode
 * that matters is DRIFT — the incremental mirror disagreeing with a from-scratch
 * `buildN3Store`, which would silently produce WRONG SPARQL results. These tests
 * are the guard: after varied add/remove/reindex sequences, the live mirror must
 * hold exactly the same flattened quads as a fresh rebuild, and queries against
 * it must match queries against a rebuild.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import * as $rdf from 'rdflib';
import type * as N3 from 'n3';
import { initGraph, indexNote, removeNote, queryGraph, indexAllNotes } from '../../../src/main/graph/index';
import { buildN3Store, getState, resetN3Mirror, MINERVA, RDF } from '../../../src/main/graph/state';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';

function termKey(t: N3.Term): string {
  if (t.termType === 'Literal') {
    return `L${t.value}${t.datatype?.value ?? ''}${t.language ?? ''}`;
  }
  return `${t.termType}${t.value}`;
}

/** The flattened triple set of an N3.Store (graph ignored — the mirror flattens
 *  everything into the default graph, and buildN3Store does the same). */
function tripleSet(store: N3.Store): Set<string> {
  const keys = new Set<string>();
  for (const q of store.getQuads(null, null, null, null)) {
    keys.add(`${termKey(q.subject)}${termKey(q.predicate)}${termKey(q.object)}`);
  }
  return keys;
}

/** Assert the live incremental mirror equals a from-scratch rebuild of the same
 *  rdflib store — the core anti-drift invariant. */
function expectMirrorMatchesRebuild(ctx: ProjectContext): void {
  const state = getState(ctx)!;
  expect(state.n3Cache, 'mirror should be live after a query').not.toBeNull();
  const fresh = buildN3Store(state.store);
  expect([...tripleSet(state.n3Cache!)].sort()).toEqual([...tripleSet(fresh)].sort());
}

describe('incremental N3 mirror (#1110)', () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-n3mirror-'));
    ctx = projectContext(root);
    await initGraph(ctx);
  });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('matches a fresh rebuild after a mixed index / remove / reindex sequence', async () => {
    await indexNote(ctx, 'a.md', '---\ntitle: A\ntags: [x, y]\n---\n# A\n\n[[b]] and [[c]]\n');
    await indexNote(ctx, 'b.md', '---\ntitle: B\ntags: [y]\n---\n# B\n\n[[a]]\n');
    await indexNote(ctx, 'c.md', '---\ntitle: C\n---\n# C\n');
    // Build the mirror.
    await queryGraph(ctx, 'SELECT ?s WHERE { ?s a minerva:Note } LIMIT 10');
    expectMirrorMatchesRebuild(ctx);

    // More writes on top of the live mirror.
    await indexNote(ctx, 'd.md', '---\ntitle: D\ntags: [x]\n---\n# D\n\n[[a]]\n');
    removeNote(ctx, 'c.md');
    // Reindex a.md with different content (tags/links change).
    await indexNote(ctx, 'a.md', '---\ntitle: A2\ntags: [z]\n---\n# A2\n\n[[d]]\n');
    expectMirrorMatchesRebuild(ctx);
  });

  it('produces identical SPARQL results from the live mirror and a fresh rebuild', async () => {
    await indexNote(ctx, 'a.md', '---\ntitle: A\ntags: [x, y]\n---\n# A\n\n[[b]]\n');
    await indexNote(ctx, 'b.md', '---\ntitle: B\ntags: [y]\n---\n# B\n');
    const q = 'SELECT ?note ?title WHERE { ?note a minerva:Note ; dc:title ?title } ORDER BY ?title';

    const live = await queryGraph(ctx, q);          // builds + uses the live mirror
    resetN3Mirror(getState(ctx)!);                  // force a from-scratch rebuild
    const rebuilt = await queryGraph(ctx, q);
    expect(live.error).toBeFalsy();
    expect(live.results).toEqual(rebuilt.results);

    // After a further incremental write, the two paths still agree.
    await indexNote(ctx, 'c.md', '---\ntitle: C\n---\n# C\n');
    const live2 = await queryGraph(ctx, q);
    resetN3Mirror(getState(ctx)!);
    const rebuilt2 = await queryGraph(ctx, q);
    expect(live2.results).toEqual(rebuilt2.results);
  });

  it('keeps a triple shared across two named graphs until the LAST graph drops it (rdflib refcount)', async () => {
    // Build a live mirror first so the wrapped mutations maintain it.
    await queryGraph(ctx, 'SELECT ?s WHERE { ?s ?p ?o } LIMIT 1');
    const state = getState(ctx)!;
    const s = $rdf.sym('urn:x:shared'); const p = RDF('type'); const o = MINERVA('Widget');
    const g1 = $rdf.sym('urn:x:g1'); const g2 = $rdf.sym('urn:x:g2');

    state.store.add(s, p, o, g1);
    state.store.add(s, p, o, g2); // same flattened (s,p,o), different named graph
    expectMirrorMatchesRebuild(ctx);
    const key = `NamedNodeurn:x:sharedNamedNode${RDF('type').value}NamedNode${MINERVA('Widget').value}`;
    expect(tripleSet(state.n3Cache!).has(key)).toBe(true);

    // Removing g1's copy must NOT drop the flattened quad — g2 still asserts it.
    state.store.removeMatches(s, p, o, g1);
    expect(tripleSet(state.n3Cache!).has(key)).toBe(true);
    expectMirrorMatchesRebuild(ctx);

    // Removing the last copy drops it.
    state.store.removeMatches(s, p, o, g2);
    expect(tripleSet(state.n3Cache!).has(key)).toBe(false);
    expectMirrorMatchesRebuild(ctx);
  });

  it('is correct when writes happen while the mirror is cold (no query yet)', async () => {
    // No query → n3Cache stays null → these writes are NOT mirrored incrementally.
    await indexNote(ctx, 'a.md', '---\ntitle: A\ntags: [x]\n---\n# A\n');
    await indexNote(ctx, 'b.md', '---\ntitle: B\n---\n# B\n\n[[a]]\n');
    // First query builds from scratch — must be correct, and equal a rebuild.
    await queryGraph(ctx, 'SELECT ?s WHERE { ?s a minerva:Note }');
    expectMirrorMatchesRebuild(ctx);
  });

  it('rebuilds a correct mirror after indexAllNotes swaps the store', async () => {
    fs.writeFileSync(path.join(root, 'one.md'), '---\ntitle: One\ntags: [k]\n---\n# One\n\n[[two]]\n');
    fs.writeFileSync(path.join(root, 'two.md'), '---\ntitle: Two\n---\n# Two\n');
    await indexNote(ctx, 'one.md', fs.readFileSync(path.join(root, 'one.md'), 'utf-8'));
    await queryGraph(ctx, 'SELECT ?s WHERE { ?s a minerva:Note }'); // live mirror on old store

    await indexAllNotes(ctx); // swaps state.store, resets + re-instruments the mirror
    await queryGraph(ctx, 'SELECT ?s WHERE { ?s a minerva:Note }');
    expectMirrorMatchesRebuild(ctx);

    // And an incremental write on the new store still tracks.
    await indexNote(ctx, 'three.md', '---\ntitle: Three\n---\n# Three\n\n[[one]]\n');
    expectMirrorMatchesRebuild(ctx);
  });

  it('stays correct across many small writes (exercises the periodic-rebuild fallback)', async () => {
    await queryGraph(ctx, 'SELECT ?s WHERE { ?s ?p ?o } LIMIT 1'); // go live
    // Enough reindexes to cross the periodic-rebuild threshold at least once.
    for (let i = 0; i < 60; i++) {
      await indexNote(ctx, `n${i % 8}.md`, `---\ntitle: N${i}\ntags: [t${i % 4}]\n---\n# N${i}\n\n[[n${(i + 1) % 8}]]\n`);
    }
    await queryGraph(ctx, 'SELECT ?s WHERE { ?s a minerva:Note }');
    expectMirrorMatchesRebuild(ctx);
  });
});
