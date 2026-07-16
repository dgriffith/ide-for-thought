/**
 * Cold N3-rebuild benchmark (perf #1109 — proves the need for #1110). Not run
 * by `pnpm test` — invoke with `pnpm bench`.
 *
 * `n3-cache.bench.ts` measures the warm cache-hit cost. This measures the
 * opposite: the full O(triples) `buildN3Store` rebuild that `queryGraph` pays
 * whenever a write invalidated the cache — `indexNote` calls `invalidate` on
 * every edit (see `state.ts`), nulling `state.n3Cache` so the very next query
 * rebuilds the whole N3 mirror from scratch before it can run.
 *
 * Each iteration pairs one trivial re-index (invalidates the cache, exactly
 * like any real edit does) with the query that follows it — the "write then
 * query" pattern `buildN3Store`'s own comment already flags as the expensive
 * case (`N3_REBUILD_WARN_MS` in `state.ts`). Run at three vault scales so the
 * O(n) growth is visible, and so an eventual incremental-N3 fix (#1110) has a
 * baseline to beat.
 *
 * Seeding runs as a top-level `await` per scale, ahead of any `describe`/
 * `bench` call, rather than inside `beforeAll` — vitest's benchmark runner
 * does not reliably await an async `beforeAll` before starting a `bench`'s
 * iterations (confirmed empirically: a `beforeAll` here never completed
 * before `bench` began running against still-`undefined` state). Top-level
 * `await` is a plain module-evaluation order guarantee, so it isn't subject
 * to that gap.
 */

import { describe, bench } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initGraph, indexAllNotes, queryGraph, indexNote } from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';

const SCALES = [500, 2000, 5000];

for (const scale of SCALES) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-n3cold-'));
  const ctx: ProjectContext = projectContext(root);
  await initGraph(ctx);
  // Write files to disk, then one indexAllNotes pass — the bulk (O(n),
  // #1106) path, not a slow one-by-one indexNote loop, so seeding 5,000
  // notes doesn't itself dominate the bench run's wall-clock time.
  for (let i = 0; i < scale; i++) {
    fs.writeFileSync(
      path.join(root, `note-${i}.md`),
      `# Note ${i}\n\n${'lorem ipsum '.repeat(50)}\n\n#tag-${i % 10}\n`,
    );
  }
  await indexAllNotes(ctx);

  describe(`cold N3 rebuild — ${scale}-note store`, () => {
    bench(`re-index (invalidates) + queryGraph (cold rebuild) at ${scale} notes`, async () => {
      // A no-op re-index of the same note with the same content — it still
      // invalidates the N3 cache the same way any real save does, without
      // changing what the query below actually matches.
      await indexNote(ctx, 'note-0.md', `# Note 0\n\n${'lorem ipsum '.repeat(50)}\n\n#tag-0\n`);
      await queryGraph(ctx, 'SELECT ?n WHERE { ?n a minerva:Note } LIMIT 50');
    });
  });
}
