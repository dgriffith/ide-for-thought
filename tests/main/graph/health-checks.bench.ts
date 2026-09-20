/**
 * `runAllChecks` benchmark (#2211, reproducing the perf review's C1). Not run
 * by `pnpm test` — invoke with `pnpm bench`.
 *
 * The gap this fills: the inspections sweep runs debounced off every graph
 * write, and nothing measured it. It fires ~17 whole-graph SPARQL queries plus
 * a full-corpus disk scan (`findOrphanedInlineAssets`) and an O(n log n) sort,
 * all on the main thread, after a save the user is still typing into.
 *
 * Measured at three vault scales, because the question C1 asks is not "is this
 * slow" but "how does it grow" — a per-save cost that scales with corpus size
 * is a different problem from one that doesn't.
 *
 * Runs with the default settings (every check enabled), which is what a user
 * who has never opened the inspections settings has.
 *
 * Seeding runs as a top-level `await` per scale rather than in `beforeAll` —
 * see `n3-cold-rebuild.bench.ts`'s header for why.
 */

import { describe, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initGraph, indexAllNotes } from '../../../src/main/graph/index';
import { runAllChecks } from '../../../src/main/graph/health-checks';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';
import { trackTempDir } from '../../helpers/bench-temp-dirs';

const SCALES = [500, 2000, 5000];

for (const scale of SCALES) {
  const root = trackTempDir(fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-healthchecks-')));
  const ctx: ProjectContext = projectContext(root);
  await initGraph(ctx);
  for (let i = 0; i < scale; i++) {
    fs.writeFileSync(
      path.join(root, `note-${i}.md`),
      `# Note ${i}\n\n${'lorem ipsum '.repeat(50)}\n\n#tag-${i % 10}\n\n[[note-${(i + 1) % scale}]]\n`,
    );
  }
  await indexAllNotes(ctx);

  describe(`runAllChecks — ${scale}-note store`, () => {
    test(`runAllChecks at ${scale} notes`, async ({ bench }) => {
      await bench(`runAllChecks at ${scale} notes`, async () => {
        await runAllChecks(ctx);
      }).run();
    });
  });
}
