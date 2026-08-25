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
import { describe, bench } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initGraph, indexNote } from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';
import { trackTempDir } from '../../helpers/bench-temp-dirs';

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

describe('graph indexing', () => {
  // Re-index the same path in place (indexNote strips the note's prior triples
  // then re-adds), so each iteration is a stable steady-state cost rather than
  // a monotonically growing store.
  bench(`indexNote: a note (title + tag + wiki-link) into a ${SEED_NOTES}-note store`, async () => {
    await indexNote(
      ctx,
      'bench-note.md',
      `# Bench Note\n\nBody with a #tag-3 and a [[seed-1]] link and ${'more words '.repeat(30)}.\n`,
    );
  });
});
