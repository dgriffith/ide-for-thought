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
import { initGraph, indexAllNotes, queryGraphRows } from '../../../src/main/graph/index';
import { wikiLinkIndex } from '../../../src/main/graph/note-index';
import { initSearch, indexAllNotes as searchIndexAllNotes, search } from '../../../src/main/search/index';
import { writeAndReindex, type WritePipelineHooks } from '../../../src/main/notebase/write-pipeline';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';
import { trackTempDir } from '../../helpers/bench-temp-dirs';
import { assertFixtureReaches } from '../../helpers/bench-fixture';

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

const BENCH_PATH = 'notes/research/bench-note-under-test.md';
const BENCH_NOTE = `# Bench Note\n\nBody with a #tag-3 and a [[${noteTarget(1)}]] link and ${'more words '.repeat(30)}.\n`;

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
  const searchIndexed = await searchIndexAllNotes(ctx);

  // ── What this fixture must reach (#2383) ───────────────────────────────────
  // A save is three things — the file, the graph, the search index — and the
  // link-index size is the whole point of the fixture's filenames (#2211). So:
  // both indexes hold the full vault; the resolver index carries the ~6 suffix
  // entries per note a real vault's nested multi-word paths produce (the
  // `note-${i}` fixture produced 1); and one save lands in all three places,
  // with its wiki-link resolved against the seeded notes rather than dangling.
  {
    assertFixtureReaches(`the search index holds all ${scale} seeded notes`, searchIndexed === scale, searchIndexed);
    const suffixes = wikiLinkIndex(ctx).bySuffixSlug.size;
    assertFixtureReaches(
      `the link index carries the multi-segment suffix entries of real filenames (>= ${5 * scale})`,
      suffixes >= 5 * scale,
      suffixes,
    );

    await writeAndReindex(root, BENCH_PATH, BENCH_NOTE, noopHooks);
    assertFixtureReaches('the save writes the note to disk', fs.readFileSync(path.join(root, BENCH_PATH), 'utf-8') === BENCH_NOTE);
    const link = await queryGraphRows(ctx, `
      SELECT ?target WHERE {
        ?n minerva:relativePath "${BENCH_PATH}" ; minerva:references ?t .
        ?t minerva:relativePath ?target .
      }`);
    const target = (link.results[0] as Record<string, string> | undefined)?.target;
    assertFixtureReaches(`the save indexes the note's wiki-link, resolved to ${notePath(1)}`, target === notePath(1), link.results);
    const hits = await search(ctx, 'Bench Note', { limit: 5 });
    assertFixtureReaches(
      'the save reaches the search index',
      hits.some((h) => h.relativePath === BENCH_PATH),
      hits.map((h) => h.relativePath),
    );
  }

  describe(`writeAndReindex — ${scale}-note vault`, () => {
    test(`writeAndReindex: re-save one note in a ${scale}-note vault`, async ({ bench }) => {
      await bench(`writeAndReindex: re-save one note in a ${scale}-note vault`, async () => {
        await writeAndReindex(root, BENCH_PATH, BENCH_NOTE, noopHooks);
      }).run();
    });
  });
}
