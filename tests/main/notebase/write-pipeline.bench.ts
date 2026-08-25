/**
 * Save-pipeline end-to-end benchmark (perf #1109). Not run by `pnpm test` —
 * invoke with `pnpm bench`.
 *
 * `writeAndReindex` (graph.indexNote + search.indexNote + a search-index
 * persist) is the real per-save hot path — every autosave tick runs it. This
 * benches the whole thing at three vault scales, catching a regression in
 * any of its three steps or in how they interact. As of #1107 the persist
 * step is a debounced `schedulePersist`, not an immediate `search.persist` —
 * so this bench also demonstrates that win: no full-index JSON write happens
 * per iteration here, only the graph + search indexing of the one changed
 * note. (Any debounced write the bench's own iterations schedule is harmless
 * to leave pending — the process exits once the bench run ends.)
 *
 * Seeding runs as a top-level `await` per scale (see the header comment in
 * `n3-cold-rebuild.bench.ts` for why: `beforeAll` doesn't reliably complete
 * before a `bench`'s iterations start in this vitest version's benchmark
 * runner — confirmed empirically). `afterAll` doesn't share that problem —
 * it's a teardown-ordering guarantee, not a setup one — so temp-dir cleanup
 * below goes through it via `trackTempDir` (#1933), also confirmed
 * empirically.
 */

import { describe, bench } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initGraph, indexAllNotes } from '../../../src/main/graph/index';
import { initSearch, indexAllNotes as searchIndexAllNotes } from '../../../src/main/search/index';
import { writeAndReindex, type WritePipelineHooks } from '../../../src/main/notebase/write-pipeline';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';
import { trackTempDir } from '../../helpers/bench-temp-dirs';

const SCALES = [500, 2000, 5000];

const noopHooks: WritePipelineHooks = {
  markPathHandled: () => {},
  broadcastRewritten: () => {},
  broadcastHeadingRename: () => {},
};

for (const scale of SCALES) {
  const root = trackTempDir(fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-savepipeline-')));
  const ctx: ProjectContext = projectContext(root);
  await initGraph(ctx);
  await initSearch(ctx);
  for (let i = 0; i < scale; i++) {
    fs.writeFileSync(
      path.join(root, `note-${i}.md`),
      `# Note ${i}\n\n${'lorem ipsum '.repeat(20)}\n\n#tag-${i % 20}\n\n[[note-${(i + 1) % scale}]]\n`,
    );
  }
  // Bulk-seed both indexes (the O(n) path, #1106) rather than looping
  // writeAndReindex itself here — that's what the bench below measures.
  await indexAllNotes(ctx);
  await searchIndexAllNotes(ctx);

  describe(`writeAndReindex — ${scale}-note vault`, () => {
    bench(`writeAndReindex: re-save one note in a ${scale}-note vault`, async () => {
      await writeAndReindex(
        root,
        'bench-note.md',
        `# Bench Note\n\nBody with a #tag-3 and a [[note-1]] link and ${'more words '.repeat(30)}.\n`,
        noopHooks,
      );
    });
  });
}
