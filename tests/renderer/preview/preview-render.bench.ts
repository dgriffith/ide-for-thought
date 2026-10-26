/**
 * @vitest-environment jsdom
 *
 * Renderer perf scenario: preview re-render of a large, citation-heavy note
 * (#2385). Not run by `pnpm test` — invoke with `pnpm bench`.
 *
 * Every other bench is main-process. This one times what `Preview.svelte` does
 * on each debounced re-render (`RENDER_DEBOUNCE_MS`, 120ms) while the user
 * types in split view:
 *
 *   1. `md.render` through the preview's full plugin battery
 *      (`createPreviewMarkdown`) and `sanitizeNoteHtml` — `renderContent`;
 *   2. the HTML landing in the preview root;
 *   3. the two citation DOM passes the post-render effect starts —
 *      `resolveCiteQuoteLabels` (cite-meta cache warm, as it is after the
 *      first render of a note) and `applyCslMarkers`.
 *
 * The IPC half of step 3 (`citations.renderInline`, `graph.query`) is stubbed
 * to resolve at once: its cost is main-process citeproc, already on the
 * #2226 config memo's side of the boundary. What's timed here is what the
 * renderer's own thread pays per keystroke-debounced render — the part a
 * regression in a markdown plugin, the sanitizer or a citation DOM pass would
 * show up in.
 *
 * Two entries so a regression names its half: render + sanitize alone, and
 * the whole re-render.
 *
 * jsdom, not the happy-dom the preview unit tests use: under happy-dom every
 * `sanitizeNoteHtml` call on this note retained ~250MB (DOMPurify's scratch
 * document is never collected there), so the bench ran out of heap after a
 * dozen iterations. jsdom holds steady. Neither is Chromium — read these as a
 * trend against the committed baseline, not as the milliseconds a user sees.
 * The biggest distortion is jsdom's own speed at building DOM, and it has
 * moved under us once: on jsdom 30.1.1 (measured 2026-09-30) `applyCslMarkers`
 * was ~750ms of the full entry's ~1.16s locally, nearly all of it 440
 * `displayEl.innerHTML = marker` writes. jsdom 30.1.2 fixed a large-DOM-tree
 * slowdown introduced in 30.1.0 (#2778 took it), and the full entry fell ~5x
 * with no change of ours (#2852): locally ~380ms now, ~175ms of it render +
 * sanitize. So a jump in the full entry with the render + sanitize entry flat
 * points at the citation passes OR at a jsdom bump; check the lockfile, and
 * confirm in the real app before reading it as user-visible.
 */
import { describe, test } from 'vitest';
import { assertFixtureReaches } from '../../helpers/bench-fixture';
import { buildLargeNote } from '../helpers/large-note';

const SECTIONS = 200;
const CITES_PER_SECTION = 2;
const note = buildLargeNote(SECTIONS, CITES_PER_SECTION);

// `ipc/client.ts` reads `window.api` at module evaluation, so the stub has to
// be in place before `citation-render` is imported — hence the dynamic imports.
let renderInlineCalls = 0;
(window as unknown as { api: unknown }).api = {
  citations: {
    renderInline: async (refs: { kind: string; id: string }[]) => {
      renderInlineCalls++;
      return {
        markers: refs.map((_, i) => `[${i + 1}]`),
        bibliography: refs.map((r, i) => `${i + 1}. ${r.id}`),
        missing: [],
        styleId: 'ieee',
      };
    },
  },
  graph: {
    // First render of a note misses the cite-meta cache and batches every
    // source into one VALUES query; answer it so the cache warms.
    query: async () => ({
      ok: true,
      columns: ['sid', 'title', 'creator', 'issued'],
      results: [...new Set(note.sourceIds)].map((sid) => ({ sid, title: `Title of ${sid}`, creator: 'Author, A.', issued: '2020' })),
    }),
  },
};

const { createPreviewMarkdown } = await import('../../../src/renderer/lib/preview/markdown-config');
const { sanitizeNoteHtml } = await import('../../../src/renderer/lib/preview/sanitize-note-html');
const { applyCslMarkers, resolveCiteQuoteLabels } = await import('../../../src/renderer/lib/preview/citation-render');
const { stripFrontmatter, countFrontmatterLines } = await import('../../../src/renderer/lib/preview/text');

const md = createPreviewMarkdown({
  collapsedFences: new Set<number>(),
  runningFences: new Set<number>(),
  getRenderPathOverride: () => null,
  getNotePath: () => 'research/large.md',
  getCanRun: () => false,
});

/** `Preview.svelte`'s `renderContent` for a markdown note. */
function renderContent(c: string): string {
  return sanitizeNoteHtml(md.render(stripFrontmatter(c), { lineOffset: countFrontmatterLines(c) }));
}

const previewEl = document.createElement('div');
document.body.appendChild(previewEl);
let bibliography: string[] | null = null;
const citeDeps = {
  previewEl,
  citeMetaCache: new Map(),
  quoteMetaCache: new Map(),
  queryPrefixes: '',
  setBibliographyEntries: (entries: string[] | null) => { bibliography = entries; },
};

async function rerender(): Promise<void> {
  previewEl.innerHTML = renderContent(note.text);
  await Promise.all([resolveCiteQuoteLabels(citeDeps), applyCslMarkers(citeDeps)]);
}

// ── What this fixture must reach (#2383) ─────────────────────────────────────
// Warm-up render doubles as the check. The note must survive render + sanitize
// with every cite and quote link intact (a sanitizer that stripped the data
// attributes would leave the citation passes nothing to do, and the bench
// would time an empty querySelectorAll), and the passes must actually run:
// markers swapped in, a bibliography set, tooltips populated from the cache.
{
  await rerender();
  const cites = previewEl.querySelectorAll<HTMLElement>('.cite-link[data-source-id]');
  const quotes = previewEl.querySelectorAll<HTMLElement>('.quote-link[data-excerpt-id]');
  assertFixtureReaches(`the rendered note carries all ${note.citeCount} cite links`, cites.length === note.citeCount, cites.length);
  assertFixtureReaches(`the rendered note carries all ${note.quoteCount} quote links`, quotes.length === note.quoteCount, quotes.length);
  assertFixtureReaches('applyCslMarkers reached the IPC and set a bibliography', renderInlineCalls === 1 && bibliography?.length === note.citeCount + note.quoteCount, { renderInlineCalls, bibliography: bibliography?.length });
  assertFixtureReaches('CSL markers replaced the cite display text', cites[0]?.querySelector('.link-display')?.textContent === '[1]', cites[0]?.querySelector('.link-display')?.textContent);
  assertFixtureReaches('cite tooltips resolved into the cache', citeDeps.citeMetaCache.size === new Set(note.sourceIds).size && cites[0]?.dataset.tooltipKind === 'cite', citeDeps.citeMetaCache.size);
  assertFixtureReaches('the note is large enough to matter', note.lines > 3000, note.lines);
}

const label = `${note.lines}-line note with ${note.citeCount} citations`;

// Capped samples, the way full-index.bench.ts caps indexAllNotes. On the
// macos-latest runner the full re-render took ~3.5s a sample on jsdom 30.1.1
// (~0.5s since 30.1.2), and the default 64-sample floor put the test at the
// bench config's 300s `testTimeout`: the first CI bless took 13 minutes and
// the second timed out.
// Locally the relative margin of error is ~1.5% at 64 samples, so 10 loses
// little precision. The cap goes to `.run()`: in vitest 5 the options argument
// of `bench(name, options, fn)` is per-function hooks, and sampling options
// passed there are silently ignored.
const SAMPLES = { iterations: 10, warmupIterations: 2, time: 0, warmupTime: 0 };

describe('preview re-render', () => {
  test(`preview render + sanitize: ${label}`, async ({ bench }) => {
    await bench(`preview render + sanitize: ${label}`, () => {
      renderContent(note.text);
    }).run(SAMPLES);
  });

  test(`preview re-render (render, DOM, citation passes): ${label}`, async ({ bench }) => {
    await bench(`preview re-render (render, DOM, citation passes): ${label}`, async () => {
      await rerender();
    }).run(SAMPLES);
  });
});
