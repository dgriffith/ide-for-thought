/**
 * Full-`indexAllNotes` benchmark (perf #1109 — proves the #1106 alias-hoist
 * win). Not run by `pnpm test` — invoke with `pnpm bench`.
 *
 * `graph-index.bench.ts` measures one `indexNote` call's steady-state cost
 * against an already-populated store — useful for catching a per-note
 * regression, but it doesn't exercise `indexAllNotes`'s own scaling
 * characteristic. Before #1106, `indexNote` unconditionally rebuilt the
 * alias map (O(n) in total note count) on every note during the full-index
 * walk, making that walk O(n²); #1106 hoists the rebuild out of the loop.
 * Run at three vault scales so the O(n) result — not a partially-masked
 * O(n²) curve — is directly visible in the numbers, and so a future
 * regression back to per-note rebuilding would show up as a scale cliff here.
 *
 * Seeding runs as a top-level `await` per scale (see the header comment in
 * `n3-cold-rebuild.bench.ts` for why: `beforeAll` doesn't reliably complete
 * before a `bench`'s iterations start in this vitest version's benchmark
 * runner — confirmed empirically).
 */

import { describe, bench } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initGraph, indexAllNotes } from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';
import { trackTempDir } from '../../helpers/bench-temp-dirs';

const SCALES = [500, 2000, 5000];

for (const scale of SCALES) {
  const root = trackTempDir(fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-fullidx-')));
  const ctx: ProjectContext = projectContext(root);
  await initGraph(ctx);
  for (let i = 0; i < scale; i++) {
    const aliasBlock = i % 5 === 0 ? `---\naliases:\n  - alias-${i}\n---\n` : '';
    fs.writeFileSync(
      path.join(root, `note-${i}.md`),
      `${aliasBlock}# Note ${i}\n\n${'lorem ipsum '.repeat(20)}\n\n#tag-${i % 20}\n\n[[note-${(i + 1) % scale}]]\n`,
    );
  }

  describe(`full indexAllNotes — ${scale}-note vault`, () => {
    bench(
      `indexAllNotes: ${scale} notes from scratch`,
      async () => {
        // indexAllNotes resets and rebuilds the whole store on every call, so
        // it's safe (and necessary, to measure the real full-index cost rather
        // than a warm no-op) to call it fresh on every bench iteration against
        // the same on-disk files.
        await indexAllNotes(ctx);
      },
      // A single rebuild is O(seconds) at the top scale, and each one allocates
      // a fresh multi-thousand-node rdflib graph — the default 10-iteration
      // floor piles ~15 of those onto the heap and turns a ~2.5s op into an
      // 11-minute, GC-thrashing, ±200%-variance sample. A few iterations give a
      // representative number without the pile-up (the regression gate treats
      // this bench as tracked-not-gated for the same variance reason — see
      // bench-baseline.json).
      { iterations: 3, warmupIterations: 1, time: 0, warmupTime: 0 },
    );
  });
}
