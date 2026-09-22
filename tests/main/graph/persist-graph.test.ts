/**
 * `persistGraph` writes the user's graph without disturbing the store (#2209).
 *
 * It used to strip ~1,100 ontology triples out of the store, serialize, and
 * add them all back. That cost twice over:
 *
 *   - `removeMatches` is a linear scan of `store.statements`, so the strip was
 *     O(|ontology| × T) — 326ms at 3,000 notes, fully synchronous.
 *   - ~2,200 mirror mutations in one call sailed past
 *     `N3_PERIODIC_REBUILD_EVERY` (1,000) and nulled `state.n3Cache`, so the
 *     next query paid a full cold `buildN3Store`. Measured at 2,000 notes:
 *     warm query 2.18ms, post-persist 32.80ms — a 15× regression caused
 *     entirely by bookkeeping that changed nothing.
 *
 * None of it was needed: the ontology already lives in its own named graphs
 * and `$rdf.serialize` takes the graph to emit. These tests pin the two things
 * that make that substitution safe rather than merely faster — the file is the
 * same, and the store is genuinely untouched.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as $rdf from 'rdflib';
import {
  persistGraph,
  serializeGraph,
  serializeUserGraph,
  indexNote,
} from '../../../src/main/graph/index';
import { getState, buildN3Store } from '../../../src/main/graph/state';
import { type ProjectContext } from '../../../src/main/project-context-types';
import { useGraphProject } from '../../helpers/temp-project';

/**
 * Triples split the way `serializeUserGraph` splits them: ontology statements
 * are the ones sitting in the graphs `addOntologyToStore` parsed them into,
 * everything else is the user's.
 *
 * Worth stating precisely, because the obvious guess is wrong and cost a
 * rewrite of this fix: user data is NOT in the default graph. `indexNote`
 * files each note's triples under a per-note named graph
 * (`…/note/notes/a`), and only a handful of project-level statements land in
 * the default graph. A first version of #2209 serialized the default graph
 * alone — which would have dropped every note from `graph.ttl`. This test
 * caught it.
 */
function graphCounts(ctx: ProjectContext): { user: number; ontology: number } {
  const state = getState(ctx)!;
  const ontologyGraphs = new Set(state.ontologyStatements.map((st) => st.graph?.value ?? ''));
  let user = 0;
  let ontology = 0;
  for (const st of state.store.statements) {
    if (ontologyGraphs.has(st.graph?.value ?? '')) ontology += 1;
    else user += 1;
  }
  return { user, ontology };
}

describe('persistGraph writes only the user graph (#2209)', () => {
  const project = useGraphProject('minerva-persist-graph-');
  let ctx: ProjectContext;
  let root: string;

  beforeEach(async () => {
    ctx = project.ctx;
    root = project.root;
    for (let i = 0; i < 25; i++) {
      await indexNote(ctx, `notes/n${i}.md`, `---\ntitle: Note ${i}\ntags: [alpha]\n---\n\n# Note ${i}\n`);
    }
  });

  it('the ontology occupies graphs of its own — the premise of the whole fix', () => {
    // If the ontology ever stopped carrying its own named graph, the filter
    // would start emitting it into every project's graph.ttl. And if note
    // data ever moved INTO an ontology graph, the filter would drop it.
    // Everything below rests on this separation.
    const { user, ontology } = graphCounts(ctx);
    expect(user).toBeGreaterThan(50);
    expect(ontology).toBeGreaterThan(500);
  });

  it('note data is in per-note named graphs, not the default graph', () => {
    // Pinned explicitly because it is the assumption a reader is most likely
    // to get wrong — and did: serializing `$rdf.defaultGraph()` looks like the
    // clean way to exclude the ontology and silently drops every note.
    const store = getState(ctx)!.store;
    const defaults = store.statements.filter((st) => st.graph?.termType === 'DefaultGraph');
    const perNote = store.statements.filter((st) => /\/note\/notes\//.test(st.graph?.value ?? ''));
    expect(perNote.length).toBeGreaterThan(defaults.length * 5);
  });

  it('the written file carries the user data and not the ontology', async () => {
    await persistGraph(ctx);
    const written = fs.readFileSync(path.join(root, '.minerva', 'graph.ttl'), 'utf-8');

    expect(written).toContain('notes/n0.md');
    // A class only the bundled ontology declares. Its presence would mean a
    // copy of the vocabulary in every project's graph.ttl — which is what
    // `addOntologyToStore` strips and replaces at load anyway.
    expect(written).not.toContain('thought:Claim');
    expect(written).not.toMatch(/ontology\/thought#Claim/);
  });

  it('matches what the old strip-and-restore produced, byte for byte', async () => {
    // The issue's stated merge condition. Reproduce the old algorithm here and
    // compare — a serializer that reordered or re-abbreviated anything would
    // churn every project's graph.ttl on first save under the new code.
    const state = getState(ctx)!;
    const { store, ontologyStatements } = state;

    for (const st of ontologyStatements) store.removeMatches(st.subject, st.predicate, st.object);
    const oldWay = $rdf.serialize(null, store, 'urn:x-minerva:void', 'text/turtle') ?? '';
    for (const st of ontologyStatements) store.add(st.subject, st.predicate, st.object, st.graph);

    expect(serializeUserGraph(ctx)).toBe(oldWay);
  });

  it('leaves the store exactly as it found it', async () => {
    const before = graphCounts(ctx);
    const beforeTotal = getState(ctx)!.store.statements.length;

    await persistGraph(ctx);

    expect(graphCounts(ctx)).toEqual(before);
    expect(getState(ctx)!.store.statements.length).toBe(beforeTotal);
  });
});

describe('persistGraph does not null the N3 mirror (#2209)', () => {
  const project = useGraphProject('minerva-persist-mirror-');
  let ctx: ProjectContext;

  beforeEach(async () => {
    ctx = project.ctx;
    for (let i = 0; i < 20; i++) {
      await indexNote(ctx, `notes/m${i}.md`, `---\ntitle: M${i}\n---\n\n# M${i}\n`);
    }
  });

  it('keeps the warm mirror across a persist', () => {
    // The 15× regression in one assertion. 2,200 mutations per call crossed
    // the periodic-rebuild threshold every time, so `n3Cache` was null by the
    // time the next query arrived. Serializing mutates nothing, so it survives.
    const state = getState(ctx)!;
    state.n3Cache = buildN3Store(state.store);
    const warm = state.n3Cache;
    expect(warm).not.toBeNull();

    void persistGraph(ctx);

    expect(getState(ctx)!.n3Cache, 'persistGraph nulled the N3 mirror').toBe(warm);
  });

  it('does not advance the mirror write counter', () => {
    // The mechanism underneath: `__minervaN3Writes` counts store mutations and
    // triggers `resetN3Mirror` at 1,000. A persist should contribute zero.
    const store = getState(ctx)!.store as unknown as { __minervaN3Writes?: number };
    const before = store.__minervaN3Writes ?? 0;

    void persistGraph(ctx);

    expect(store.__minervaN3Writes ?? 0).toBe(before);
  });

  it('the surviving mirror still agrees with a from-scratch rebuild', async () => {
    // The issue's risk note asks for exactly this: keeping the incremental
    // mirror is only safe if it is still correct. A mirror that survived but
    // had drifted would be worse than one that was nulled.
    const state = getState(ctx)!;
    state.n3Cache = buildN3Store(state.store);
    await persistGraph(ctx);

    const survived = getState(ctx)!.n3Cache!;
    const fresh = buildN3Store(getState(ctx)!.store);
    expect(survived.size).toBe(fresh.size);
  });
});

describe('serializeGraph still includes the ontology', () => {
  const project = useGraphProject('minerva-serialize-full-');

  it('export keeps emitting a self-contained file', async () => {
    // `exportGraph` deliberately ships the vocabulary so a stranger can read
    // the file without Minerva to hand — #2233 settled that after the menu and
    // the IPC channel disagreed. Splitting out `serializeUserGraph` must not
    // quietly change the export.
    const ctx = project.ctx;
    await indexNote(ctx, 'notes/x.md', '---\ntitle: X\n---\n\n# X\n');

    const full = serializeGraph(ctx);
    const userOnly = serializeUserGraph(ctx);

    expect(full.length).toBeGreaterThan(userOnly.length);
    expect(full).toMatch(/ontology\/thought#/);
    expect(userOnly).not.toMatch(/ontology\/thought#Claim/);
  });
});
