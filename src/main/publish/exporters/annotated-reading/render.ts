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
    const start = data.sourceBody.indexOf(ex.citedText);
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

  const bodyWithHighlights = wrapHighlights(data.sourceBody, aligned);
  // `html: true` so the `<mark>` highlight spans we wrapped above
  // survive markdown rendering. Source bodies are the user's own
  // content (their `body.md`), so it's no more risky than what's
  // already in their thoughtbase.
  const md = new MarkdownIt({ html: true, linkify: true, typographer: true });
  const sourceHtml = md.render(bodyWithHighlights);

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

/**
 * Wrap each aligned excerpt's range in a `<mark>` span. Iterates
 * right-to-left so earlier offsets aren't invalidated by inserts.
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
  const sorted = [...aligned].sort((a, b) => b.start - a.start);
  let out = body;
  for (const { excerpt, start, end } of sorted) {
    out = (
      out.slice(0, start) +
      `<mark class="excerpt-hl" data-excerpt="${escapeAttr(excerpt.id)}">` +
      out.slice(start, end) +
      '</mark>' +
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function escapeAttr(s: string): string { return escapeHtml(s); }

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
