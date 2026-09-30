/**
 * @vitest-environment node
 *
 * Renderer perf scenario (#2385): the markdown half of one debounced preview
 * re-render, in a large, citation-heavy note. Not run by `pnpm test` — invoke
 * with `pnpm bench`.
 *
 * Typing in split view re-renders the preview once per 120ms idle window
 * (`RENDER_DEBOUNCE_MS` in `Preview.svelte`). The synchronous part of that
 * re-render is `renderContent`: `stripFrontmatter` → the preview's markdown-it
 * (`createPreviewMarkdown` — the full plugin battery: KaTeX math, callouts,
 * footnotes, wiki/cite/quote links, tags, heading anchors, fences) →
 * `sanitizeNoteHtml` → `{@html}`. This bench times the first two, on the same
 * markdown-it instance the component builds once and reuses.
 *
 * It runs under the `node` environment on purpose: the markdown pass is pure
 * JS and needs no DOM, so what it times is the app's code on the same V8 the
 * renderer runs, with no DOM emulator in the measurement.
 *
 * WHAT IS LEFT OUT, AND WHY — measured, not assumed (#2385):
 *
 *   - DOMPurify and the `{@html}` DOM build. Both are DOM-construction work,
 *     and under a JS DOM they time the emulator, not the app. Sanitizing this
 *     fixture took ~500ms per call under jsdom (it is a no-op on this input:
 *     output length == input length), and under happy-dom twenty consecutive
 *     calls grew the heap past 2.5GB and OOMed the worker. A gate whose ratio
 *     moves on a jsdom upgrade is one people learn to ignore.
 *   - The post-render citation passes (`applyCslMarkers`,
 *     `resolveCiteQuoteLabels`, `markBrokenWikiLinks`). Tried as a second
 *     bench over the rendered 300-citation preview with the IPC stubbed:
 *     ~1s per pass under jsdom, almost all of it jsdom's `innerHTML` setter
 *     on the 300 marker swaps, and 25-50ms per pass under happy-dom, most of
 *     it its selector engine. Neither is the app's number. The main-process
 *     side of those passes (citeproc, the #2226 project-config memo) belongs
 *     in a main bench.
 *   - Layout, style recalc and paint — no JS DOM has them.
 *   - highlight.js, which runs after paint, off this path.
 *
 * So this is not "preview latency". It is the part of it that grows with note
 * size and citation count and that app code controls, measured cleanly.
 */
import { describe, test } from 'vitest';
import { createPreviewMarkdown } from '../../../src/renderer/lib/preview/markdown-config';
import { stripFrontmatter, countFrontmatterLines } from '../../../src/renderer/lib/preview/text';

// ── fixture ────────────────────────────────────────────────────────────────
// ~1,900 lines / ~110KB: 60 sections, each with four cited paragraphs (240
// cites over 60 sources), a quoted excerpt (60 quotes), inline math, wiki-
// links, a typed link, tags, a 20-item list and a footnote — a long
// literature-review note.
const SECTIONS = 60;
const SOURCES = 60;
const CITES = SECTIONS * 4;
const QUOTES = SECTIONS;

function buildNote(): string {
  const lines: string[] = ['---', 'title: Literature review', 'tags: [review, bench]', '---', ''];
  let cite = 0;
  for (let s = 0; s < SECTIONS; s++) {
    lines.push(`## Section ${s}: argument ${s}`, '');
    for (let p = 0; p < 4; p++) {
      const src = `src-${cite++ % SOURCES}`;
      lines.push(
        `Paragraph ${p} of section ${s} makes a claim about #topic-${s % 7} that ` +
          `rests on prior work [[cite::${src}]] and relates to [[note-${(s + p) % 40}]]. ` +
          `The effect size is $d = 0.${p + 2}$ and it replicates in the follow-up study.[^f${s}]`,
        '',
      );
    }
    lines.push(`> Quoted evidence: [[quote::ex-${s}]] — see also [[supports::note-${s % 40}]].`, '');
    for (let i = 0; i < 20; i++) {
      lines.push(`- point ${i} in section ${s}, with *emphasis* and \`code\``);
    }
    lines.push('', `[^f${s}]: Footnote for section ${s}.`, '');
  }
  return lines.join('\n');
}
const NOTE = buildNote();
const LINES = NOTE.split('\n').length;

// Built once, exactly as Preview.svelte builds it, and reused across renders.
const md = createPreviewMarkdown({
  collapsedFences: new Set<number>(),
  runningFences: new Set<number>(),
  getRenderPathOverride: () => null,
  getNotePath: () => 'review.md',
  getCanRun: () => false,
});

/** Preview.svelte's `renderContentRaw` for a markdown note. */
function renderMarkdown(c: string): string {
  return md.render(stripFrontmatter(c), { lineOffset: countFrontmatterLines(c) });
}

// Fail loudly on a fixture that stopped producing what it claims to: a syntax
// or plugin change that dropped the citations or the math would leave the
// bench timing something much cheaper and reporting it as a speedup.
{
  const html = renderMarkdown(NOTE);
  const count = (re: RegExp): number => (html.match(re) ?? []).length;
  const got = {
    cites: count(/class="wiki-link typed-link cite-link"/g),
    quotes: count(/class="wiki-link typed-link quote-link"/g),
    math: count(/class="katex"/g),
    footnoteRefs: count(/class="footnote-ref"/g),
  };
  if (got.cites !== CITES || got.quotes !== QUOTES || got.math !== CITES || got.footnoteRefs !== CITES) {
    throw new Error(
      `preview-render bench fixture is broken: expected ${CITES} cites, ${QUOTES} quotes, ` +
        `${CITES} math spans and ${CITES} footnote refs; got ${JSON.stringify(got)}`,
    );
  }
}

// A keystroke: each iteration renders text that differs from the last by a
// character, so nothing downstream can short-circuit on identical input.
let tick = 0;

const NAME = 'preview markdown render: 1,900-line note, 300 citations';

describe(`renderer: preview re-render of a ${LINES}-line note (#2385)`, () => {
  test(NAME, async ({ bench }) => {
    await bench(NAME, () => {
      tick++;
      renderMarkdown(`${NOTE}\n\nTyping${'x'.repeat(tick % 8)}`);
    }).run();
  });
});
