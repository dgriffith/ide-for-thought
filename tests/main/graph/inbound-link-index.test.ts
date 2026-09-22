/**
 * @vitest-environment node
 *
 * Inbound-link lookups don't scan the project per note (#2215).
 *
 * Before this, every backlink question walked all twelve note-targeted link
 * predicates' whole buckets — i.e. every note→note edge in the project — to
 * find the anchored (`<note>#heading`) objects rdflib's object index can't
 * reach by prefix. Measured on a synthetic 3,000-note × 5-link thoughtbase:
 * one `backlinks()` call examined 15,016 statements to return 5 rows, and
 * `neighborhood()` runs one per BFS node up to `cap = 200`, so a depth-5 walk
 * examined 3,007,200.
 *
 * ── Why these gates count scans and not milliseconds ────────────────────────
 *
 * Per #2229: "the panel issues one project-wide scan, not one per note" is a
 * property of the algorithm and fails deterministically when the shape
 * regresses. A millisecond threshold on a machine that also runs 70 other test
 * files flaps, and the first flake teaches everyone to re-bless it. So the
 * counter here is the number of `statementsMatching(undefined, <link
 * predicate>, undefined)` calls — the exact operation that costs O(total links
 * in the project) — and the assertions are on its count, not on the clock.
 *
 * ── Why the invalidation half is the larger half ────────────────────────────
 *
 * #2215 named the real risk itself: a cached backlink list that silently omits
 * a link the user just wrote is worse than a slow one. The anchored index is
 * keyed on the store's monotonic mutation counter, bumped at the #2231
 * `store.add` / `store.removeMatches` chokepoint every triple mutation in the
 * system passes through. These tests exercise each writer that can change an
 * inbound edge — a new note, an edited note, a deleted note, a raw Turtle
 * load, a full rebuild that swaps the store — plus a parity check against a
 * brute-force reference implementation, because "the fast path agrees with the
 * slow path on a randomized corpus" catches shapes an enumerated case list
 * doesn't.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as $rdf from 'rdflib';
import {
  indexNote,
  removeNote,
  indexAllNotes,
  backlinks,
  findNotesLinkingTo,
  findExternalInboundLinks,
  neighborhood,
  parseIntoStore,
} from '../../../src/main/graph/index';
import { findNotesLinkingToAnchor } from '../../../src/main/graph/queries';
import { getState, storeMutationCount, linkPredicate, noteUri, MINERVA } from '../../../src/main/graph/state';
import { inboundStatements, NOTE_TARGETED_LINK_TYPES } from '../../../src/main/graph/queries/inbound-links';
import { type ProjectContext } from '../../../src/main/project-context-types';
import { useGraphProject } from '../../helpers/temp-project';
import fs from 'node:fs';
import path from 'node:path';

/** The IRIs of every predicate whose full bucket is a project-wide link scan. */
const LINK_PREDICATE_IRIS = new Set(NOTE_TARGETED_LINK_TYPES.map((lt) => linkPredicate(lt).value));

interface ScanCounter {
  /** Calls of the form `statementsMatching(undefined, <link predicate>, undefined)`. */
  projectWideScans: number;
  /** Statements handed back across every call — the work the caller then walks. */
  statementsReturned: number;
}

/**
 * Wrap this project's store so every `statementsMatching` is counted, and
 * return a live counter plus a reset. Deliberately wraps the live store rather
 * than a fake: the whole claim under test is about which rdflib index a query
 * lands in, which a fake would define away.
 */
function countScans(ctx: ProjectContext): { counts: ScanCounter; reset: () => void } {
  const state = getState(ctx)!;
  const store = state.store as unknown as {
    statementsMatching: (...a: unknown[]) => $rdf.Statement[];
  };
  const orig = store.statementsMatching.bind(store);
  const counts: ScanCounter = { projectWideScans: 0, statementsReturned: 0 };
  store.statementsMatching = (...args: unknown[]): $rdf.Statement[] => {
    const result = orig(...args);
    const [s, p, o] = args as [unknown, { value?: string } | undefined, unknown];
    if (s == null && o == null && p?.value && LINK_PREDICATE_IRIS.has(p.value)) {
      counts.projectWideScans += 1;
    }
    counts.statementsReturned += result.length;
    return result;
  };
  return { counts, reset: () => { counts.projectWideScans = 0; counts.statementsReturned = 0; } };
}

/** A hub note plus `n` notes linking at it, half of them through an anchor. */
async function buildHub(ctx: ProjectContext, n: number): Promise<void> {
  await indexNote(ctx, 'hub.md', '# Hub\n\n## Section A\n');
  for (let i = 0; i < n; i++) {
    const target = i % 2 === 0 ? '[[hub]]' : '[[hub#section-a]]';
    // Each linker also links to its successor, so a depth-2 walk out of `hub`
    // has real work to do at every node instead of terminating immediately.
    await indexNote(ctx, `n${i}.md`, `# N${i}\n\nSee ${target} and [[n${(i + 1) % n}]].\n`);
  }
}

describe('#2215 — inbound-link lookups are O(inbound degree)', () => {
  const project = useGraphProject('minerva-2215-');
  let ctx: ProjectContext;
  beforeEach(() => { ctx = project.ctx; });

  describe('count gates (#2229 — scans, not milliseconds)', () => {
    it('a repeat backlinks() in the same generation issues NO project-wide link scan', async () => {
      await buildHub(ctx, 12);

      const { counts, reset } = countScans(ctx);
      backlinks(ctx, 'hub.md');
      // The first call in a generation pays one index build — twelve bucket
      // reads, one per note-targeted link type. That's the deliberate deal:
      // the cost of a single pre-#2215 lookup, amortized over the generation.
      expect(counts.projectWideScans).toBe(NOTE_TARGETED_LINK_TYPES.length);

      reset();
      const second = backlinks(ctx, 'hub.md');
      expect(second.length).toBe(12);
      expect(counts.projectWideScans).toBe(0);
    });

    it('neighborhood() issues ONE index build, not one project scan per BFS node', async () => {
      await buildHub(ctx, 24);

      const { counts } = countScans(ctx);
      const result = neighborhood(ctx, 'hub.md', { depth: 2 });
      // The walk really does expand many nodes — otherwise the gate below
      // would pass vacuously on a one-node neighborhood.
      expect(result.nodes.length).toBeGreaterThan(20);
      // Before #2215 this was 12 × (number of expanded nodes). The whole point
      // is that it no longer scales with the walk at all.
      expect(counts.projectWideScans).toBe(NOTE_TARGETED_LINK_TYPES.length);
    });

    it('findNotesLinkingTo() over many targets scans the project once, not once per target', async () => {
      await buildHub(ctx, 20);

      const { counts } = countScans(ctx);
      // The folder-rename shape: one lookup per moved descendant
      // (notebase/rename.ts:188,285). Before #2215 this was 12 × 20 scans.
      for (let i = 0; i < 20; i++) findNotesLinkingTo(ctx, `n${i}.md`);
      expect(counts.projectWideScans).toBe(NOTE_TARGETED_LINK_TYPES.length);
    });

    it('findNotesLinkingToAnchor() — on the save path — issues no project-wide scan at all', async () => {
      await buildHub(ctx, 12);

      const { counts } = countScans(ctx);
      // The anchored target IRI is fully known, so this is a plain
      // object-index hit and doesn't even need the index built.
      const linkers = findNotesLinkingToAnchor(ctx, 'hub.md', 'section-a');
      expect(linkers.length).toBe(6);
      expect(counts.projectWideScans).toBe(0);
    });

    it('findExternalInboundLinks() scans once for a whole multi-note selection', async () => {
      await buildHub(ctx, 16);

      const { counts } = countScans(ctx);
      const blockers = findExternalInboundLinks(ctx, ['n0.md', 'n2.md', 'n4.md', 'n6.md']);
      expect(blockers.length).toBeGreaterThan(0);
      expect(counts.projectWideScans).toBe(NOTE_TARGETED_LINK_TYPES.length);
    });
  });

  describe('invalidation — every writer that can change an inbound edge', () => {
    it('a newly written ANCHORED backlink appears immediately', async () => {
      await buildHub(ctx, 4);
      expect(backlinks(ctx, 'hub.md').map((b) => b.source)).not.toContain('late.md');

      await indexNote(ctx, 'late.md', '# Late\n\nSee [[hub#section-a]].\n');

      expect(backlinks(ctx, 'hub.md').map((b) => b.source)).toContain('late.md');
      expect(findNotesLinkingTo(ctx, 'hub.md')).toContain('late.md');
    });

    it('an EDITED note that gains an anchored link appears immediately', async () => {
      await indexNote(ctx, 'hub.md', '# Hub\n\n## Section A\n');
      await indexNote(ctx, 'editor.md', '# Editor\n\nNothing yet.\n');
      expect(backlinks(ctx, 'hub.md')).toHaveLength(0);

      await indexNote(ctx, 'editor.md', '# Editor\n\nNow: [[hub#section-a]].\n');
      expect(backlinks(ctx, 'hub.md').map((b) => b.source)).toEqual(['editor.md']);
    });

    it('an EDITED note that LOSES its anchored link stops appearing', async () => {
      await indexNote(ctx, 'hub.md', '# Hub\n\n## Section A\n');
      await indexNote(ctx, 'editor.md', '# Editor\n\nSee [[hub#section-a]].\n');
      expect(backlinks(ctx, 'hub.md').map((b) => b.source)).toEqual(['editor.md']);

      await indexNote(ctx, 'editor.md', '# Editor\n\nLink removed.\n');
      expect(backlinks(ctx, 'hub.md')).toHaveLength(0);
    });

    it('a DELETED linker stops appearing', async () => {
      // Honest note on what this does and doesn't guard, found by probing it:
      // deleting the LINKING note is the one writer a stale index survives by
      // accident. A cached statement outlives the delete, but its subject also
      // loses the `minerva:relativePath` triple every caller resolves a row
      // through, so a stale entry filters itself out and this case passes even
      // with invalidation disabled. It is kept as a behaviour test — deletion
      // really must drop the row — and the invalidation teeth live in the
      // ADDED / EDITED / Turtle / rebuild cases above and below, each of which
      // fails when the generation key is removed.
      await indexNote(ctx, 'hub.md', '# Hub\n\n## Section A\n');
      await indexNote(ctx, 'gone.md', '# Gone\n\nSee [[hub#section-a]].\n');
      await indexNote(ctx, 'stays.md', '# Stays\n\nSee [[hub#section-a]].\n');
      expect(backlinks(ctx, 'hub.md').map((b) => b.source).sort()).toEqual(['gone.md', 'stays.md']);

      removeNote(ctx, 'gone.md');
      expect(backlinks(ctx, 'hub.md').map((b) => b.source)).toEqual(['stays.md']);
      expect(findNotesLinkingTo(ctx, 'hub.md')).toEqual(['stays.md']);
    });

    it('a raw Turtle load (parseIntoStore) is seen — the bulk-write path', async () => {
      await indexNote(ctx, 'hub.md', '# Hub\n\n## Section A\n');
      await indexNote(ctx, 'ttl-src.md', '# Turtle Source\n');
      expect(backlinks(ctx, 'hub.md')).toHaveLength(0);

      // `$rdf.parse` reaches the store through `store.add` per statement, so
      // the generation counter moves even though no indexer ran (#2231).
      const state = getState(ctx)!;
      const src = noteUri(state, 'ttl-src.md').value;
      const hub = noteUri(state, 'hub.md').value;
      parseIntoStore(ctx, `<${src}> <${linkPredicate(NOTE_TARGETED_LINK_TYPES[0]!).value}> <${hub}#section-a> .`);

      expect(backlinks(ctx, 'hub.md').map((b) => b.source)).toContain('ttl-src.md');
    });

    it('a full rebuild (indexAllNotes, which SWAPS the store) is seen', async () => {
      const root = project.root;
      fs.writeFileSync(path.join(root, 'hub.md'), '# Hub\n\n## Section A\n');
      fs.writeFileSync(path.join(root, 'a.md'), '# A\n\nSee [[hub#section-a]].\n');
      await indexAllNotes(ctx);
      expect(backlinks(ctx, 'hub.md').map((b) => b.source)).toEqual(['a.md']);

      // Change the corpus on disk and rebuild. `indexAllNotes` assigns a
      // brand-new `$rdf.graph()`, so the cached index belongs to a store that
      // is no longer the project's.
      fs.writeFileSync(path.join(root, 'b.md'), '# B\n\nSee [[hub#section-a]].\n');
      fs.rmSync(path.join(root, 'a.md'));
      await indexAllNotes(ctx);

      const sources = backlinks(ctx, 'hub.md').map((b) => b.source);
      expect(sources).toEqual(['b.md']);
    });

    it('the mutation counter RESTARTS on a store swap — which is why identity is half the key', async () => {
      // This is the mechanism behind the test above, pinned separately because
      // it is the non-obvious half and it was nearly got wrong. The counter is
      // a property of the rdflib store INSTANCE, and `indexAllNotes` assigns a
      // brand-new one — so the count does not continue upward across a rebuild,
      // it starts again from zero. A cache keyed on the count alone therefore
      // collides on an ordinary rebuild of a similar-sized corpus, not only in
      // some contrived scenario: removing the identity check makes the test
      // above serve the PREVIOUS store's statements and report a deleted note
      // as a live backlink.
      fs.writeFileSync(path.join(project.root, 'hub.md'), '# Hub\n\n## Section A\n');
      fs.writeFileSync(path.join(project.root, 'a.md'), '# A\n\nSee [[hub#section-a]].\n');
      await indexAllNotes(ctx);
      const before = getState(ctx)!.store;
      const countBefore = storeMutationCount(before);
      expect(countBefore).toBeGreaterThan(0);

      fs.writeFileSync(path.join(project.root, 'b.md'), '# B\n\nSee [[hub#section-a]].\n');
      await indexAllNotes(ctx);
      const after = getState(ctx)!.store;

      expect(after).not.toBe(before);
      // Strictly more content on disk, yet the counter lands in the same range
      // rather than continuing from `countBefore` — it reset. A counter that
      // carried across the swap would land near 2x (measured: 2348 -> 2359 with
      // the reset; it would be ~4700 without), so 1.5x separates the two
      // cleanly without pinning an exact triple count that ordinary indexer
      // changes would churn.
      expect(storeMutationCount(after)).toBeLessThan(countBefore! * 1.5);
    });

    it('an UNINSTRUMENTED store reports no generation and is therefore never cached', () => {
      // A hand-built `$rdf.graph()` has no counter, so a caller that treated
      // the missing value as "generation 0" would hold its first build forever
      // while the store mutated underneath it — permanently wrong backlinks,
      // silently. `storeMutationCount` returns null so the caller opts out of
      // caching instead.
      const bare = $rdf.graph();
      expect(storeMutationCount(bare)).toBeNull();

      const state = {
        rootPath: '/nonexistent-2215', baseUri: 'https://t.test/',
        store: bare, n3Cache: null, ontologyStatements: [],
        typeCatalog: { types: [] },
      } as unknown as Parameters<typeof inboundStatements>[0];
      const hub = $rdf.sym('https://t.test/note/hub');
      const pred = linkPredicate(NOTE_TARGETED_LINK_TYPES[0]!);

      bare.add($rdf.sym('https://t.test/note/a'), pred, $rdf.sym('https://t.test/note/hub#s'));
      expect(inboundStatements(state, hub)).toHaveLength(1);

      bare.add($rdf.sym('https://t.test/note/b'), pred, $rdf.sym('https://t.test/note/hub#s'));
      expect(inboundStatements(state, hub)).toHaveLength(2);
    });
  });

  describe('parity with a brute-force reference implementation', () => {
    it('agrees on every note of a mixed corpus of plain, anchored and frontmatter links', async () => {
      // Deterministic pseudo-random so a failure is reproducible.
      let seed = 20250922;
      const rnd = (n: number): number => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed % n;
      };
      const N = 40;
      for (let i = 0; i < N; i++) {
        const t1 = rnd(N), t2 = rnd(N);
        const body = [
          `[[n${t1}]]`,
          `[[supports::n${t2}#heading-${rnd(3)}]]`,
          `[[rebuts::n${rnd(N)}]]`,
        ].join(' ');
        await indexNote(
          ctx,
          `n${i}.md`,
          `---\nabout: "[[n${rnd(N)}]]"\n---\n# N${i}\n\n## Heading 0\n## Heading 1\n## Heading 2\n\n${body}\n`,
        );
      }

      const state = getState(ctx)!;
      for (let i = 0; i < N; i++) {
        const target = noteUri(state, `n${i}.md`);
        const expected = referenceBacklinkSources(ctx, target);
        const actual = new Set(backlinks(ctx, `n${i}.md`).map((b) => b.source));
        expect([...actual].sort(), `backlinks(n${i}.md)`).toEqual([...expected].sort());
        expect(findNotesLinkingTo(ctx, `n${i}.md`).sort(), `findNotesLinkingTo(n${i}.md)`)
          .toEqual([...referenceLinkerSources(ctx, target)].sort());
      }
    });
  });
});

/**
 * The pre-#2215 algorithm, written out longhand: walk every statement in the
 * store and keep those whose object is the target IRI or an anchored variant.
 * Slow by construction, which is the point — it shares no code with the
 * implementation it checks.
 */
function referenceInbound(ctx: ProjectContext, target: $rdf.NamedNode): $rdf.Statement[] {
  const state = getState(ctx)!;
  const base = target.value;
  return state.store.statements.filter((st) => {
    const v = st.object.value;
    if (v === base) return true;
    if (!v.startsWith(`${base}#`)) return false;
    return LINK_PREDICATE_IRIS.has(st.predicate.value);
  });
}

function sourcePathOf(ctx: ProjectContext, node: $rdf.Node): string | undefined {
  const state = getState(ctx)!;
  const stmts = state.store.statementsMatching(node as $rdf.NamedNode, MINERVA('relativePath'), undefined);
  return stmts[0]?.object.value;
}

function referenceBacklinkSources(ctx: ProjectContext, target: $rdf.NamedNode): Set<string> {
  const out = new Set<string>();
  for (const st of referenceInbound(ctx, target)) {
    if (st.subject.equals(target)) continue; // a note doesn't backlink itself
    const p = sourcePathOf(ctx, st.subject);
    if (p?.endsWith('.md')) out.add(p);
  }
  return out;
}

function referenceLinkerSources(ctx: ProjectContext, target: $rdf.NamedNode): Set<string> {
  const out = new Set<string>();
  for (const st of referenceInbound(ctx, target)) {
    const p = sourcePathOf(ctx, st.subject);
    if (p?.endsWith('.md')) out.add(p);
  }
  return out;
}
