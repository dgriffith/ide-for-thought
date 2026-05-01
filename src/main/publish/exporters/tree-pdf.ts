/**
 * Note-tree single-PDF exporter (#290).
 *
 * Walks the root note's wiki-link closure (using the same
 * tree-resolved plan that powers tree-html, #251), concatenates every
 * reachable note into one HTML document with a table-of-contents and
 * page breaks between notes, then rasterises the result via the PDF
 * pipeline (#249).
 *
 * Differs from `tree-html`'s multi-file bundle: this exporter
 * produces a single self-contained PDF. Cross-links inside the
 * concatenated document resolve to in-document anchors so the
 * reader can click an inter-note reference and jump to that
 * chapter. Citations consolidate at the end via the same
 * `renderBibliographyFor` API tree-html uses (#300).
 */

import { app } from 'electron';
import { renderNoteBody } from './note-html/render';
import { renderFootnotesSection } from './note-html';
import { resolveRenderOptions, toPrintToPdfArgs } from './note-pdf/options';
import { renderPdfFromHtml } from './note-pdf/electron-render';
import { NOTE_HTML_STYLE } from './note-html/style';
import type { Exporter, ExportOutput, ExportPlan, ExportPlanFile } from '../types';

export interface BuildTreePdfHtmlResult {
  html: string;
  documentTitle: string;
  chapterCount: number;
}

/**
 * Pure HTML assembly — split out from `run()` so the bulk of the
 * exporter can be unit-tested without spinning up an Electron runtime
 * (Electron only kicks in inside `renderPdfFromHtml`).
 */
export function buildTreePdfHtml(plan: ExportPlan): BuildTreePdfHtmlResult {
  const notes = plan.inputs.filter((f) => f.kind === 'note');
  if (notes.length === 0) {
    return { html: '', documentTitle: '', chapterCount: 0 };
  }
  const rootNote = notes[0];

  const allCitedIds = new Set<string>();
  let isNoteStyle = false;
  const chapters: Array<{ note: ExportPlanFile; html: string }> = [];

  // Force follow-to-file so the cite rule and wiki-link rule emit
  // anchor tags. We then post-process those into in-document `#anchors`.
  const chapterPlan: ExportPlan = { ...plan, linkPolicy: 'follow-to-file' };

  for (const note of notes) {
    const renderer = chapterPlan.citations?.createRenderer();
    const rawBody = renderNoteBody(note, chapterPlan, renderer);
    const withFootnotes = renderer ? `${rawBody}${renderFootnotesSection(renderer)}` : rawBody;
    const rewritten = rewriteInterChapterLinks(withFootnotes, notes, rootNote);
    chapters.push({ note, html: rewritten });
    if (renderer) {
      for (const id of renderer.cited()) allCitedIds.add(id);
      if (renderer.isNoteStyle) isNoteStyle = true;
    }
  }

  // Consolidated bibliography across the whole document.
  let bibSection = '';
  if (allCitedIds.size > 0 && plan.citations) {
    const consolidator = plan.citations.createRenderer();
    const bib = consolidator.renderBibliographyFor([...allCitedIds]);
    if (bib.entries.length > 0) {
      const heading = isNoteStyle ? 'Bibliography' : 'References';
      bibSection = `<section class="references" id="chapter-bibliography">
  <h1>${heading}</h1>
  <ol>${bib.entries.map((e) => `<li>${e}</li>`).join('')}</ol>
</section>`;
    }
  }

  const documentTitle = rootNote.title;
  const tocItems = chapters.map((c, idx) => {
    const chapterNum = idx + 1;
    return `<li><a href="#${anchorFor(c.note, rootNote)}"><span class="toc-num">${chapterNum}.</span> ${escapeHtml(c.note.title)}</a></li>`;
  });
  if (bibSection) {
    tocItems.push(`<li><a href="#chapter-bibliography">${isNoteStyle ? 'Bibliography' : 'References'}</a></li>`);
  }
  const tocHtml = `<nav class="tree-pdf-toc">
  <h1>Contents</h1>
  <ol>${tocItems.join('')}</ol>
</nav>`;

  const chaptersHtml = chapters.map((c, idx) => (
    `<section class="tree-pdf-chapter" id="${anchorFor(c.note, rootNote)}">
  <header class="chapter-header"><span class="chapter-num">Chapter ${idx + 1}</span></header>
  ${c.html}
</section>`
  )).join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(documentTitle)}</title>
  <style>${NOTE_HTML_STYLE}${TREE_PDF_EXTRA_STYLE}</style>
</head>
<body>
<article>
<section class="tree-pdf-title-page">
  <h1 class="document-title">${escapeHtml(documentTitle)}</h1>
</section>
${tocHtml}
${chaptersHtml}
${bibSection}
</article>
</body>
</html>`;

  return { html, documentTitle, chapterCount: chapters.length };
}

export const treePdfExporter: Exporter = {
  id: 'tree-pdf',
  label: 'Note Tree as Single PDF',
  // Same input shape as tree-html — walking the wiki-link closure is
  // the whole point.
  accepts: (input) => input.kind === 'tree',
  acceptedKinds: ['tree'],
  async run(plan) {
    const built = buildTreePdfHtml(plan);
    if (built.chapterCount === 0) {
      return { files: [], summary: 'Nothing to export in this tree.' };
    }
    const renderOptions = resolveRenderOptions(app.getLocale(), { title: built.documentTitle });
    const args = toPrintToPdfArgs(renderOptions);
    const pdf = await renderPdfFromHtml(built.html, args);
    const files: ExportOutput['files'] = [
      { path: `${slugify(built.documentTitle)}.pdf`, contents: pdf },
    ];
    const excluded = plan.excluded.length;
    const summary = excluded > 0
      ? `PDF bundle of ${built.chapterCount} chapter${built.chapterCount === 1 ? '' : 's'} (${excluded} excluded).`
      : `PDF bundle of ${built.chapterCount} chapter${built.chapterCount === 1 ? '' : 's'}.`;
    return { files, summary };
  },
};

/** Stable per-note anchor id used in the TOC + intra-document links. */
function anchorFor(note: ExportPlanFile, rootNote: ExportPlanFile): string {
  if (note.relativePath === rootNote.relativePath) return 'chapter-root';
  return `chapter-${slugify(note.relativePath.replace(/\.md$/i, ''))}`;
}

/**
 * Rewrite inter-note `<a href="...html">` links emitted by the
 * follow-to-file resolver into in-document `#chapter-*` anchors so
 * reader clicks jump within the PDF instead of trying to open a
 * non-existent file.
 */
function rewriteInterChapterLinks(
  html: string,
  notes: ExportPlanFile[],
  rootNote: ExportPlanFile,
): string {
  let out = html;
  for (const target of notes) {
    const targetHtml = target.relativePath.replace(/\.md$/i, '.html');
    const anchor = `#${anchorFor(target, rootNote)}`;
    // Match both bare `href="x.html"` and the relative-path variants
    // the link resolver might emit (e.g. `notes/x.html`).
    const re = new RegExp(`href="(?:\\./)?${escapeRegex(targetHtml)}(?:#[^"]*)?"`, 'g');
    out = out.replace(re, `href="${anchor}"`);
  }
  return out;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'document';
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const TREE_PDF_EXTRA_STYLE = `
.tree-pdf-title-page {
  text-align: center;
  margin: 8em 0;
  page-break-after: always;
}
.tree-pdf-title-page .document-title {
  font-size: 2.4em;
  margin: 0;
  border-bottom: none;
}
.tree-pdf-toc {
  page-break-after: always;
  margin: 0 auto 2em;
}
.tree-pdf-toc h1 { border-bottom: 1px solid var(--border); padding-bottom: 0.3em; }
.tree-pdf-toc ol { list-style: none; padding-left: 0; }
.tree-pdf-toc li { margin: 0.3em 0; font-size: 1em; }
.tree-pdf-toc .toc-num {
  display: inline-block;
  min-width: 2.4em;
  color: var(--fg-muted, #4a4a4a);
}
.tree-pdf-toc a { text-decoration: none; color: var(--fg, #1a1a1a); }
.tree-pdf-toc a:hover { text-decoration: underline; }
.tree-pdf-chapter {
  page-break-before: always;
}
.tree-pdf-chapter .chapter-header {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, sans-serif;
  font-size: 0.85em;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--fg-muted, #4a4a4a);
  margin-bottom: 0.5em;
}
@media print {
  .tree-pdf-toc, .tree-pdf-chapter, .tree-pdf-title-page { page-break-inside: auto; }
}
`;
