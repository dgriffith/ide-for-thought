/**
 * `persistGraph → queryGraph` benchmark (#2211, reproducing the perf review's
 * C2). Not run by `pnpm test` — invoke with `pnpm bench`.
 *
 * The gap this fills: nothing measured the cost of a query that follows a
 * persist. `persistGraph` strips every ontology triple out of the store,
 * serializes, then adds them all back — and each of those `removeMatches`/`add`
 * calls goes through the instrumented store wrapper, so the pair walks the N3
 * mirror twice per ontology triple. The review measured a 15× query regression
 * behind it. The existing cold-rebuild bench doesn't see this at all: it pairs
 * an ordinary `indexNote` with a query, and an ordinary save never persists.
 *
 * Persisting is not rare — `proposal-persistence`, `propose-note` and
 * `conversation` all call `persistGraph`, so every approved LLM write pays this
 * before the next query.
 *
 * Run at three vault scales so the shape is visible: the strip is O(ontology
 * triples) regardless of vault size, but the mirror work it triggers is not.
 *
 * Seeding runs as a top-level `await` per scale rather than in `beforeAll` —
 * see `n3-cold-rebuild.bench.ts`'s header for why (vitest's benchmark runner
 * doesn't reliably await an async `beforeAll` before a `bench` starts).
 */

import { describe, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initGraph, indexAllNotes, queryGraph, persistGraph } from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';
import { trackTempDir } from '../../helpers/bench-temp-dirs';

const SCALES = [500, 2000, 5000];

for (const scale of SCALES) {
  const root = trackTempDir(fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-persistquery-')));
  const ctx: ProjectContext = projectContext(root);
  await initGraph(ctx);
  for (let i = 0; i < scale; i++) {
    fs.writeFileSync(
      path.join(root, `note-${i}.md`),
      `# Note ${i}\n\n${'lorem ipsum '.repeat(50)}\n\n#tag-${i % 10}\n`,
    );
  }
  await indexAllNotes(ctx);

  describe(`persistGraph → queryGraph — ${scale}-note store`, () => {
    test(`persistGraph + queryGraph at ${scale} notes`, async ({ bench }) => {
      await bench(`persistGraph + queryGraph at ${scale} notes`, async () => {
        await persistGraph(ctx);
        await queryGraph(ctx, 'SELECT ?n WHERE { ?n a minerva:Note } LIMIT 50');
      }).run();
    });
  });
}
