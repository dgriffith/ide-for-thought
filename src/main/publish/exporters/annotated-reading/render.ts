/**
 * Two-column annotated-reading HTML renderer (#253).
 *
 * Left column: source body with each excerpt's cited passage wrapped
 * in a `<mark class="excerpt-hl" data-excerpt="<id>">` so the
 * stylesheet can highlight it and the bundled JS can sync hover state
 * with the matching margin card.
 *
 * Right column: source citation block at the top, then a "Related
 * notes" section, then per-excerpt cards in source-document order.
 *
 * Excerpts whose cited text doesn't match the body fall back to
 * "couldn't locate in body" cards in the margin without a highlight,
 * and the renderer reports them so the caller can flag them in the
 * preview / summary.
 */

import MarkdownIt from 'markdown-it';
import type { CitationRenderer } from '../../csl';
import type { AnnotatedReadingData, AnnotatedExcerpt } from './resolve';
import { escapeHtmlFull as escapeHtml, escapeHtmlFull as escapeAttr } from '../../../../shared/text-escape';

export interface RenderedReading {
  /** Self-contained HTML document. */
  html: string;
  /** Excerpts whose text couldn't be aligned to the source body. */
  unalignedExcerpts: string[];
}

export interface RenderInput {
  data: AnnotatedReadingData;
  /** Display title (typically the source's `dc:title`); falls back to id. */
  sourceTitle: string;
  renderer: CitationRenderer | null;
  /**
   * `true` when the user opted in to including notes tagged
   * `private`. Default false; the resolver should already have
   * filtered them, but the flag is plumbed through for the future
   * "include private" preview toggle.
   */
  includePrivate?: boolean;
}

export function renderAnnotatedReading(input: RenderInput): RenderedReading {
  const { data, sourceTitle, renderer } = input;
  // Drop any highlight sentinel the source body itself carries, before
  // aligning, so the only ones left after wrapping are ours (#2558).
  const sourceBody = data.sourceBody.replace(HL_SENTINELS, '');

  // Align each excerpt's cited text against the source body to find
  // an offset for the highlight. Substring match for v1; fuzzy match
  // is a follow-up. Excerpts that don't align fall through to the
  // "unaligned" list.
  const aligned: Array<{ excerpt: AnnotatedExcerpt; start: number; end: number }> = [];
  const unaligned: AnnotatedExcerpt[] = [];
  for (const ex of data.excerpts) {
    if (!ex.citedText.trim()) {
      unaligned.push(ex);
      continue;
    }
    const start = sourceBody.indexOf(ex.citedText);
    if (start < 0) {
      unaligned.push(ex);
      continue;
    }
    aligned.push({ excerpt: ex, start, end: start + ex.citedText.length });
  }
  // Document-order rendering of cards: by alignment offset for
  // aligned excerpts, then unaligned at the end. Sort first, then
  // reverse-iterate when wrapping spans so earlier offsets stay valid.
  aligned.sort((a, b) => a.start - b.start);

  // Source bodies are NOT the user's own content (#2558): web, clipper and
  // ingested sources are third-party pages, and Turndown passes a page's
  // literal `<…>` text straight into `body.md`. So the body renders with
  // `html: false` — any raw HTML in it comes out as escaped text — and the
  // `<mark>` highlights travel through markdown-it as private-use sentinels,
  // swapped for real tags after rendering (`markHighlights`).
  const bodyWithHighlights = wrapHighlights(sourceBody, aligned);
  const md = new MarkdownIt({ html: false, linkify: true, typographer: true });
  const sourceHtml = markHighlights(md.render(bodyWithHighlights), aligned);

  // Citation block at the top of the margin pane.
  const citationBlock = renderer
    ? `<div class="source-citation">${renderer.renderCitation(data.sourceId)}</div>`
    : '';
  // Related notes (link to the source generally).
  const relatedHtml = data.relatedNotes.length === 0
    ? ''
    : `<section class="related-notes"><h3>Related notes</h3><ul>${
      data.relatedNotes.map((n) => `<li><a href="${escapeAttr(noteHrefFor(n.relativePath))}">${escapeHtml(n.title)}</a></li>`).join('')
    }</ul></section>`;
  // One card per excerpt, in document order. Unaligned excerpts go
  // last and wear an "unaligned" class for the stylesheet.
  const orderedExcerpts: Array<AnnotatedExcerpt & { aligned: boolean }> = [
    ...aligned.map((a) => ({ ...a.excerpt, aligned: true })),
    ...unaligned.map((u) => ({ ...u, aligned: false })),
  ];
  const cardsHtml = orderedExcerpts.map((ex) => renderExcerptCard(ex)).join('');

  // Bibliography from any cites the renderer fired during the
  // citation-block render — currently just the source itself, but
  // future iterations may render notes' citations inline too.
  const bib = renderer?.renderBibliography();
  const bibHtml = bib && bib.entries.length > 0
    ? `<section class="references"><h2>References</h2><ol>${bib.entries.map((e) => `<li>${e}</li>`).join('')}</ol></section>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(sourceTitle)}</title>
  <style>${ANNOTATED_READING_STYLE}</style>
</head>
<body>
<header class="reading-header">
  <h1>${escapeHtml(sourceTitle)}</h1>
</header>
<main class="reading">
  <article class="source-body">${sourceHtml}</article>
  <aside class="margin">
    ${citationBlock}
    ${relatedHtml}
    <section class="excerpts">${cardsHtml}</section>
  </aside>
</main>
${bibHtml}
<script>${ANNOTATED_READING_SCRIPT}</script>
</body>
</html>`;

  return { html, unalignedExcerpts: unaligned.map((u) => u.id) };
}

function renderExcerptCard(ex: AnnotatedExcerpt & { aligned: boolean }): string {
  const tagBlock = ex.tags.length > 0
    ? `<div class="excerpt-tags">${ex.tags.map((t) => `<span class="tag">#${escapeHtml(t)}</span>`).join('')}</div>`
    : '';
  const linkedBlock = ex.linkedNotes.length > 0
    ? `<ul class="excerpt-linked-notes">${ex.linkedNotes.map((n) => `<li><a href="${escapeAttr(noteHrefFor(n.relativePath))}">${escapeHtml(n.title)}</a></li>`).join('')}</ul>`
    : '';
  const locator = ex.locator ? `<span class="excerpt-loc">p. ${escapeHtml(ex.locator)}</span>` : '';
  const note = ex.aligned
    ? ''
    : '<p class="excerpt-unaligned-note">Couldn\'t locate this passage in the source body.</p>';
  return `<article class="excerpt-card${ex.aligned ? '' : ' unaligned'}" id="card-${escapeAttr(ex.id)}" data-excerpt="${escapeAttr(ex.id)}">
    <blockquote class="excerpt-text">${escapeHtml(ex.citedText)}</blockquote>
    ${locator}
    ${tagBlock}
    ${linkedBlock}
    ${note}
  </article>`;
}

// Private-use code points marking a highlight's start (`HL_OPEN` + the
// excerpt's index in `aligned` + `HL_END_INDEX`) and end (`HL_CLOSE`) through
// markdown rendering. None of them is markdown syntax or an HTML special, so
// markdown-it passes them through untouched; any already in the body are
// stripped first, so a source can't forge a highlight (#2558).
const HL_OPEN = '\uE000';
const HL_END_INDEX = '\uE001';
const HL_CLOSE = '\uE002';
const HL_SENTINELS = /[\uE000-\uE002]/g;
const HL_MARKERS = /\uE000(\d+)\uE001|\uE002/g;

/** Swap the sentinels in rendered HTML for the real `<mark>` tags. */
function markHighlights(
  html: string,
  aligned: Array<{ excerpt: AnnotatedExcerpt }>,
): string {
  return html.replace(HL_MARKERS, (_m, index: string | undefined) => {
    if (index === undefined) return '</mark>';
    const ex = aligned[Number(index)]?.excerpt;
    return ex ? `<mark class="excerpt-hl" data-excerpt="${escapeAttr(ex.id)}">` : '';
  });
}

/**
 * Wrap each aligned excerpt's range in highlight sentinels (`markHighlights`
 * turns them into `<mark>` spans after rendering). Iterates right-to-left so
 * earlier offsets aren't invalidated by inserts.
 *
 * Overlapping excerpts (a passage that's cited twice with different
 * surrounding text): the first wins; the second falls into the
 * "unaligned" bucket via a re-check after wrapping. v1 keeps it
 * simple — overlapping excerpts in the same source are rare.
 */
function wrapHighlights(
  body: string,
  aligned: Array<{ excerpt: AnnotatedExcerpt; start: number; end: number }>,
): string {
  const indexed = aligned.map((a, index) => ({ ...a, index }));
  const sorted = indexed.sort((a, b) => b.start - a.start);
  let out = body;
  for (const { start, end, index } of sorted) {
    out = (
      out.slice(0, start) +
      `${HL_OPEN}${index}${HL_END_INDEX}` +
      out.slice(start, end) +
      HL_CLOSE +
      out.slice(end)
    );
  }
  return out;
}

/**
 * Per-note URL: artifact is single-file HTML, so notes can't be
 * navigated to inside the bundle. Linking out to the source-relative
 * path is informational — readers know where to find the note in
 * their thoughtbase. Future variant could emit a multi-file bundle.
 */
function noteHrefFor(relativePath: string): string {
  return relativePath;
}

const ANNOTATED_READING_STYLE = `
:root {
  --fg: #1a1a1a;
  --fg-muted: #5a5a5a;
  --bg: #fdfdfa;
  --bg-margin: #f6f5f0;
  --accent: #2563eb;
  --highlight: #fff59d;
  --highlight-active: #ffe066;
  --border: #e1ddd0;
}
@media (prefers-color-scheme: dark) {
  :root {
    --fg: #e8e6df;
    --fg-muted: #aeaca5;
    --bg: #1d1d1b;
    --bg-margin: #262624;
    --accent: #6ea8fe;
    --highlight: #5d4e1c;
    --highlight-active: #806a26;
    --border: #353330;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font-family: Georgia, serif; line-height: 1.65; }
.reading-header { padding: 1.5em 1em; border-bottom: 1px solid var(--border); }
.reading-header h1 { margin: 0; font-family: -apple-system, sans-serif; font-weight: 600; }
.reading { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); gap: 0; max-width: 78em; margin: 0 auto; }
@media (max-width: 720px) { .reading { grid-template-columns: 1fr; } }
.source-body { padding: 2em 2em 4em; }
.source-body p { margin: 0 0 1em; }
.source-body mark.excerpt-hl { background: var(--highlight); padding: 0 0.1em; cursor: pointer; transition: background 120ms; }
.source-body mark.excerpt-hl.active { background: var(--highlight-active); }
.margin { background: var(--bg-margin); padding: 2em 1.5em; border-left: 1px solid var(--border); font-family: -apple-system, sans-serif; font-size: 0.9em; }
.source-citation { font-size: 0.95em; color: var(--fg-muted); padding-bottom: 1em; margin-bottom: 1em; border-bottom: 1px solid var(--border); }
.related-notes { margin-bottom: 1.5em; }
.related-notes h3, .excerpts h3 { font-size: 0.78em; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--fg-muted); margin: 0 0 0.5em; }
.related-notes ul { list-style: none; padding: 0; margin: 0; }
.related-notes li { margin-bottom: 0.25em; }
.excerpts { display: flex; flex-direction: column; gap: 0.7em; }
.excerpt-card { background: var(--bg); border: 1px solid var(--border); border-radius: 4px; padding: 0.7em 0.9em; transition: border-color 120ms; cursor: pointer; }
.excerpt-card.active { border-color: var(--accent); }
.excerpt-card.unaligned { opacity: 0.85; border-style: dashed; }
.excerpt-card blockquote.excerpt-text { margin: 0 0 0.5em; padding: 0; border: none; font-style: italic; color: var(--fg); font-size: 0.9em; }
.excerpt-card .excerpt-loc { font-size: 0.78em; color: var(--fg-muted); margin-right: 0.5em; }
.excerpt-card .excerpt-tags { display: inline-flex; flex-wrap: wrap; gap: 0.3em; margin-top: 0.2em; }
.excerpt-card .tag { background: var(--bg-margin); border: 1px solid var(--border); border-radius: 999px; padding: 0.05em 0.5em; font-size: 0.78em; color: var(--fg-muted); }
.excerpt-card .excerpt-linked-notes { list-style: none; padding: 0; margin: 0.5em 0 0; }
.excerpt-card .excerpt-linked-notes li { margin-bottom: 0.2em; font-size: 0.85em; }
.excerpt-card .excerpt-linked-notes a { text-decoration: none; color: var(--accent); }
.excerpt-card .excerpt-linked-notes a:hover { text-decoration: underline; }
.excerpt-card .excerpt-unaligned-note { margin: 0.4em 0 0; font-size: 0.78em; color: var(--fg-muted); font-style: italic; }
.references { max-width: 78em; margin: 2em auto; padding: 1em 2em; border-top: 1px solid var(--border); }
.references ol { padding-left: 1.5em; }
.references li { margin-bottom: 0.5em; }
@media print {
  body { background: #fff; }
  mark.excerpt-hl { background: #ffe066 !important; -webkit-print-color-adjust: exact; }
  .margin { border-left: 1px solid #ccc; background: #fafafa; }
}
`;

const ANNOTATED_READING_SCRIPT = `(function() {
  // Click or hover on an excerpt highlight or card → toggle .active on
  // both the highlight and the matching card. Read-only enhancement;
  // disabling JS leaves the HTML perfectly readable.
  function setActive(id, on) {
    document.querySelectorAll('[data-excerpt="' + CSS.escape(id) + '"]').forEach(function(el) {
      el.classList.toggle('active', on);
    });
  }
  document.body.addEventListener('mouseover', function(e) {
    var el = e.target.closest('[data-excerpt]');
    if (el) setActive(el.dataset.excerpt, true);
  });
  document.body.addEventListener('mouseout', function(e) {
    var el = e.target.closest('[data-excerpt]');
    if (el) setActive(el.dataset.excerpt, false);
  });
  document.body.addEventListener('click', function(e) {
    var el = e.target.closest('mark.excerpt-hl');
    if (!el) return;
    var card = document.getElementById('card-' + el.dataset.excerpt);
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
})();`;
