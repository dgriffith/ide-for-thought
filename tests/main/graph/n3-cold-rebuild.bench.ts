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

import { describe, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initGraph, indexAllNotes, queryGraph, queryGraphRows, indexNote } from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';
import { trackTempDir } from '../../helpers/bench-temp-dirs';
import { assertFixtureReaches } from '../../helpers/bench-fixture';
import { _n3MirrorCountsForTests } from '../../../src/main/graph/state';

const SCALES = [500, 2000, 5000];
const QUERY = 'SELECT ?n WHERE { ?n a minerva:Note } LIMIT 50';
const noteBody = (i: number): string => `# Note ${i}\n\n${'lorem ipsum '.repeat(50)}\n\n#tag-${i % 10}\n`;
/** note-0's seeded content, byte-identical — so the re-index changes nothing the query sees. */
const NOTE_0 = noteBody(0);

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
      noteBody(i),
    );
  }
  await indexAllNotes(ctx);

  // ── What this fixture must reach (#2383) ───────────────────────────────────
  // The path under test is the INCREMENTAL one (#1110): a write applied as a
  // delta to a live N3 mirror, then a query against it. That needs the mirror
  // warm before the write (a query first), and the re-index to actually
  // remove and re-add note-0's triples through it — a write that skipped the
  // mirror would leave this timing a cold build under an incremental name.
  {
    const warm = await queryGraphRows(ctx, QUERY);
    assertFixtureReaches(`the query matches 50 of the ${scale} seeded notes`, warm.results.length === 50, warm.results.length);
    const before = _n3MirrorCountsForTests.deltaWrites;
    await indexNote(ctx, 'note-0.md', NOTE_0);
    const applied = _n3MirrorCountsForTests.deltaWrites - before;
    assertFixtureReaches('the re-index applies its triples to the live N3 mirror', applied > 0, applied);
  }

  describe(`cold N3 rebuild — ${scale}-note store`, () => {
    test(`re-index (invalidates) + queryGraph (cold rebuild) at ${scale} notes`, async ({ bench }) => {
      await bench(`re-index (invalidates) + queryGraph (cold rebuild) at ${scale} notes`, async () => {
        // A no-op re-index of the same note with the same content — the same
        // write path any real save takes (post-#1110 it applies its delta to the
        // live mirror rather than nulling it), without changing what the query
        // below matches. (Bench name kept verbatim for baseline-key stability.)
        await indexNote(ctx, 'note-0.md', NOTE_0);
        await queryGraph(ctx, QUERY);
      }).run();
    });
  });
}
