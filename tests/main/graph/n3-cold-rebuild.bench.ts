/**
 * Save→query benchmark (perf #1109 → #1110). Not run by `pnpm test` — invoke
 * with `pnpm bench`.
 *
 * HISTORY: this measured the full O(triples) `buildN3Store` rebuild that
 * `queryGraph` used to pay after every write — `invalidate` nulled the whole N3
 * mirror, so the very next query rebuilt it from scratch (hundreds of ms at 5k
 * notes). #1110 made the mirror INCREMENTAL: `invalidate` no longer nulls it;
 * `instrumentStoreMirror` applies each write's delta to the live mirror. So this
 * bench now measures the incremental save→query path — O(changed triples), not
 * O(all triples). The cliff it was written to expose is removed: at 5k notes it
 * dropped from ~148ms to ~6ms. (The name/keys are kept stable so the committed
 * bench baseline still lines up; re-bless to lock in the win.)
 *
 * Each iteration pairs one trivial re-index with the query that follows it — the
 * "write then query" pattern. Run at three vault scales so the (now near-flat)
 * growth is visible.
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
import { trackTempDir } from '../../helpers/bench-temp-dirs';

const SCALES = [500, 2000, 5000];

for (const scale of SCALES) {
  const root = trackTempDir(fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-n3cold-')));
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
      // A no-op re-index of the same note with the same content — the same
      // write path any real save takes (post-#1110 it applies its delta to the
      // live mirror rather than nulling it), without changing what the query
      // below matches. (Bench name kept verbatim for baseline-key stability.)
      await indexNote(ctx, 'note-0.md', `# Note 0\n\n${'lorem ipsum '.repeat(50)}\n\n#tag-0\n`);
      await queryGraph(ctx, 'SELECT ?n WHERE { ?n a minerva:Note } LIMIT 50');
    });
  });
}
