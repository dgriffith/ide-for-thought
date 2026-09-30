/**
 * Graph indexing-latency benchmark (#1004). Not run by `pnpm test` — invoke
 * with `pnpm bench`.
 *
 * Measures the per-note cost of `indexNote` against a store that already holds
 * a realistic number of notes, so a regression in the indexer's cost-at-scale
 * (extract title/tags/wiki-links, mutate the rdflib store, invalidate the N3
 * mirror) becomes visible as vaults grow.
 *
 * Seeding runs as a top-level `await`, ahead of the `describe`/`bench` calls,
 * rather than inside `beforeAll` (perf #1109 finding): vitest's benchmark
 * runner does not reliably await an async `beforeAll` before starting a
 * `bench`'s iterations — confirmed empirically (a `beforeAll` here never
 * completed before `bench` began running against still-`undefined` state).
 * Top-level `await` is a plain module-evaluation order guarantee, so it
 * isn't subject to that gap.
 */
import { describe, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initGraph, indexNote, queryGraphRows } from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';
import { trackTempDir } from '../../helpers/bench-temp-dirs';
import { assertFixtureReaches } from '../../helpers/bench-fixture';

const SEED_NOTES = 500;

const root = trackTempDir(fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-idxbench-')));
const ctx: ProjectContext = projectContext(root);
await initGraph(ctx);
// Populate the store so indexNote runs against a non-trivial graph, not an
// empty one — that's where the cost that matters lives.
for (let i = 0; i < SEED_NOTES; i++) {
  await indexNote(
    ctx,
    `seed-${i}.md`,
    `# Seed ${i}\n\n${'lorem ipsum '.repeat(40)}\n\n#tag-${i % 10}\n\n[[seed-${(i + 1) % SEED_NOTES}]]\n`,
  );
}

const BENCH_NOTE = `# Bench Note\n\nBody with a #tag-3 and a [[seed-1]] link and ${'more words '.repeat(30)}.\n`;

// ── What this fixture must reach (#2383) ─────────────────────────────────────
// A per-note cost "at scale" needs the scale to be in the store, and the note
// under test to do the three things its name says: a title, a tag, and a
// wiki-link that RESOLVES against the seeded notes — an unresolved link skips
// the resolver lookup the bench is meant to include.
{
  const notes = await queryGraphRows(ctx, 'SELECT (COUNT(?n) AS ?c) WHERE { ?n a minerva:Note }');
  const count = Number((notes.results[0] as Record<string, string> | undefined)?.c);
  assertFixtureReaches(`the store holds all ${SEED_NOTES} seeded notes`, count === SEED_NOTES, count);

  await indexNote(ctx, 'bench-note.md', BENCH_NOTE);
  const edges = await queryGraphRows(ctx, `
    SELECT ?title ?tag ?target WHERE {
      ?n minerva:relativePath "bench-note.md" ; dc:title ?title ;
         minerva:hasTag/minerva:tagName ?tag ; minerva:references ?t .
      ?t minerva:relativePath ?target .
    }`);
  const row = edges.results[0] as Record<string, string> | undefined;
  assertFixtureReaches(
    'the note under test indexes a title, a tag, and a wiki-link resolved to seed-1.md',
    row?.title === 'Bench Note' && row.tag === 'tag-3' && row.target === 'seed-1.md',
    edges.results,
  );
}

describe('graph indexing', () => {
  // Re-index the same path in place (indexNote strips the note's prior triples
  // then re-adds), so each iteration is a stable steady-state cost rather than
  // a monotonically growing store.
  test(`indexNote: a note (title + tag + wiki-link) into a ${SEED_NOTES}-note store`, async ({ bench }) => {
    await bench(`indexNote: a note (title + tag + wiki-link) into a ${SEED_NOTES}-note store`, async () => {
      await indexNote(ctx, 'bench-note.md', BENCH_NOTE);
    }).run();
  });
});
