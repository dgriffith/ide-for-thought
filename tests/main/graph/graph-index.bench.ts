/**
 * Graph indexing-latency benchmark (#1004). Not run by `pnpm test` — invoke
 * with `pnpm bench`.
 *
 * Measures the per-note cost of `indexNote` against a store that already holds
 * a realistic number of notes, so a regression in the indexer's cost-at-scale
 * (extract title/tags/wiki-links, mutate the rdflib store, invalidate the N3
 * mirror) becomes visible as vaults grow.
 */
import { describe, bench, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initGraph, indexNote } from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';

const SEED_NOTES = 500;

describe('graph indexing', () => {
  let ctx: ProjectContext;

  beforeAll(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-idxbench-'));
    ctx = projectContext(root);
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
  });

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
