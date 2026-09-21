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

import { describe, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initGraph, indexAllNotes } from '../../../src/main/graph/index';
import { initSearch, indexAllNotes as searchIndexAllNotes } from '../../../src/main/search/index';
import { writeAndReindex, type WritePipelineHooks } from '../../../src/main/notebase/write-pipeline';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';
import { trackTempDir } from '../../helpers/bench-temp-dirs';

const SCALES = [500, 2000, 5000];

/**
 * Realistic note paths, not `note-0.md` (#2211).
 *
 * `buildWikiLinkIndex` adds one `bySuffixSlug` entry per dash-segment of a
 * note's slugged stem, minus one. `note-0` slugs to two segments and therefore
 * contributes a single entry; a real vault's nested, multi-word filenames
 * contribute five or six. Seeding the save-path benches with the former made
 * the committed baseline understate the per-save link-index cost by roughly
 * that factor — which matters because `buildLinkResolveCtx` rebuilds that index
 * on every save (the perf review's H3).
 *
 * This shape slugs to `notes-research-design-note-about-topic-<i>` — seven
 * segments, six suffix entries — so the bench measures a link index the size a
 * user would actually have.
 */
function notePath(i: number): string {
  return `notes/research/design-note-about-topic-${i}.md`;
}

/** The wiki-link target for `notePath(i)` — the stem, as a user would type it. */
function noteTarget(i: number): string {
  return `design-note-about-topic-${i}`;
}

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
    const abs = path.join(root, notePath(i));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(
      abs,
      `# Note ${i}\n\n${'lorem ipsum '.repeat(20)}\n\n#tag-${i % 20}\n\n[[${noteTarget((i + 1) % scale)}]]\n`,
    );
  }
  // Bulk-seed both indexes (the O(n) path, #1106) rather than looping
  // writeAndReindex itself here — that's what the bench below measures.
  await indexAllNotes(ctx);
  await searchIndexAllNotes(ctx);

  describe(`writeAndReindex — ${scale}-note vault`, () => {
    test(`writeAndReindex: re-save one note in a ${scale}-note vault`, async ({ bench }) => {
      await bench(`writeAndReindex: re-save one note in a ${scale}-note vault`, async () => {
        await writeAndReindex(
          root,
          'notes/research/bench-note-under-test.md',
          `# Bench Note\n\nBody with a #tag-3 and a [[${noteTarget(1)}]] link and ${'more words '.repeat(30)}.\n`,
          noopHooks,
        );
      }).run();
    });
  });
}
