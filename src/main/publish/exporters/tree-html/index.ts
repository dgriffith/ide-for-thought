/**
 * Note-tree HTML bundle exporter (#251).
 *
 * Given the ExportPlan of a tree-mode resolve — root note + its
 * transitive wiki-link closure — render every note as HTML using the
 * same pipeline as #248's note-html exporter, but with link resolution
 * forced to `follow-to-file` and the root renamed to `index.html`.
 * Cross-links inside the bundle resolve relative to each page.
 *
 * Every page links to a single shared `style.css` at the bundle root
 * and carries a sidebar with the manifest tree (#292) — the current
 * page is highlighted so a reader can jump around without back-button
 * acrobatics.
 *
 * Each note gets its own `CitationRenderer` so per-note footnote
 * numbering is local (Chicago full-note, etc.); cited-id sets are
 * unioned across notes and the merged bibliography lands in a single
 * `references.html` at the bundle root (#300).
 *
 * Deferred to follow-up tickets: manual deselection of notes (#293).
 */

import { renderNoteBody, inlineImages } from '../note-html/render';
import { wrapHtml } from '../note-html/shell';
import { renderFootnotesSection } from '../note-html';
import { NOTE_HTML_STYLE } from '../note-html/style';
import type { Exporter, ExportOutput, ExportPlan, ExportPlanFile } from '../../types';

export const treeHtmlExporter: Exporter = {
  id: 'tree-html',
  label: 'Note Tree as HTML Bundle',
  // Only the tree scope — walking wiki-link closures is the whole point.
  accepts: (input) => input.kind === 'tree',
  acceptedKinds: ['tree'],
  async run(plan) {
    // The root is the first entry of the resolver's BFS order.
    const rootPath = plan.rootPath ?? '';
    const notes = plan.inputs.filter((f) => f.kind === 'note');
    if (notes.length === 0) {
      return { files: [], summary: 'Nothing to export in this tree.' };
    }
    const rootNote = notes[0];

    // Force follow-to-file even when the plan's linkPolicy is
    // inline-title — within a bundle the user clearly wants cross-links
    // to work, and inline-title is the wrong default here.
    const bundlePlan: ExportPlan = { ...plan, linkPolicy: 'follow-to-file' };

    // Track cited ids across every note so the bundle-level References
    // page de-dupes (a single Brooks 1986 entry, even when 5 notes
    // cite it). Note-style footnotes stay per-note since the inline
    // `<sup>1</sup>` markers anchor to that note's `fn-1` — running
    // the counter bundle-wide would only confuse readers.
    const allCitedIds = new Set<string>();
    let isNoteStyle = false;

    const files: ExportOutput['files'] = [];
    for (const note of notes) {
      const renderer = bundlePlan.citations?.createRenderer();
      const rawBody = renderNoteBody(note, bundlePlan, renderer);
      // Note styles: append the per-note footnotes (the inline `<sup>`
      // markers anchor to them). In-text styles: nothing here — the
      // bundle-level References page below carries the bibliography.
      const noteHasCites = (renderer?.cited().size ?? 0) > 0;
      const withFootnotes = renderer ? `${rawBody}${renderFootnotesSection(renderer)}` : rawBody;
      const withRefLink = appendBundleReferenceLink(withFootnotes, note, rootNote, noteHasCites);
      const body = await inlineImages(withRefLink, note, rootPath, bundlePlan.assetPolicy);
      const rootRel = relativeToRoot(note.relativePath, rootNote);
      const html = wrapHtml({
        title: note.title,
        body,
        stylesheetHref: `${rootRel}style.css`,
        sidebarHtml: renderSidebar(notes, rootNote, note.relativePath, rootRel),
      });
      files.push({
        path: outputPathFor(note, rootNote),
        contents: html,
      });
      if (renderer) {
        for (const id of renderer.cited()) allCitedIds.add(id);
        if (renderer.isNoteStyle) isNoteStyle = true;
      }
    }

    // Bundle-level References page. Emitted only when at least one
    // note actually cited something — empty bundles don't grow a
    // useless `references.html` stub.
    if (allCitedIds.size > 0 && bundlePlan.citations) {
      const consolidator = bundlePlan.citations.createRenderer();
      const bib = consolidator.renderBibliographyFor([...allCitedIds]);
      if (bib.entries.length > 0) {
        const heading = isNoteStyle ? 'Bibliography' : 'References';
        const entries = bib.entries.map((e) => `<li>${e}</li>`).join('\n');
        const refsBody = `<h1>${heading}</h1>\n<section class="references">\n<ol>\n${entries}\n</ol>\n</section>`;
        files.push({
          path: 'references.html',
          contents: wrapHtml({
            title: heading,
            body: refsBody,
            stylesheetHref: 'style.css',
            sidebarHtml: renderSidebar(notes, rootNote, 'references.html', ''),
          }),
        });
      }
    }

    // Shared stylesheet at the bundle root (#292). Appended only when
    // we actually emitted notes — empty bundles don't get a stub
    // style.css.
    if (files.length > 0) {
      files.push({
        path: 'style.css',
        contents: `${NOTE_HTML_STYLE}\n${BUNDLE_NAV_STYLE}`,
      });
    }

    const excluded = plan.excluded.length;
    const summary = excluded > 0
      ? `Bundle of ${files.length} file${files.length === 1 ? '' : 's'} (${excluded} excluded).`
      : `Bundle of ${files.length} file${files.length === 1 ? '' : 's'}.`;
    return { files, summary };
  },
};

/**
 * Number of `../` segments needed to reach the bundle root from a
 * given note's emitted path. The root note (index.html) sits at depth
 * 0; `notes/foo.html` is depth 1 (one `../`); `sub/deep/leaf.html` is
 * depth 2 (`../../`). Used for the per-page stylesheet + sidebar
 * link hrefs so deep-nested pages still resolve cleanly.
 */
function relativeToRoot(relativePath: string, rootNote: ExportPlanFile): string {
  if (relativePath === rootNote.relativePath) return '';
  const depth = relativePath.split('/').length - 1;
  return depth === 0 ? '' : '../'.repeat(depth);
}

/**
 * Sidebar nav (#292): a flat list of every page in the bundle. The
 * current page is marked with `aria-current="page"` and a CSS class
 * so the reader knows where they are. Order follows the resolver's
 * BFS manifest so the visual structure matches the underlying tree.
 */
function renderSidebar(
  notes: ExportPlanFile[],
  rootNote: ExportPlanFile,
  currentPath: string,
  rootRel: string,
): string {
  const items = notes.map((note) => {
    const href = note.relativePath === rootNote.relativePath
      ? `${rootRel}index.html`
      : rootRel + note.relativePath.replace(/\.md$/i, '.html');
    const isCurrent = note.relativePath === currentPath
      || (currentPath === 'references.html' && false /* references is its own item below */);
    const cls = isCurrent ? 'current' : '';
    const aria = isCurrent ? ' aria-current="page"' : '';
    return `<li class="${cls}"><a href="${escapeAttr(href)}"${aria}>${escapeHtml(note.title)}</a></li>`;
  });
  return `<nav class="bundle-tree"><h2 class="bundle-tree-heading">Pages</h2><ol>${items.join('')}</ol></nav>`;
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

const BUNDLE_NAV_STYLE = `
/* Tree-html bundle: shared stylesheet + sidebar nav (#292). */
body.with-sidebar {
  display: grid;
  grid-template-columns: minmax(180px, 240px) minmax(0, 1fr);
  gap: 0;
  align-items: start;
  padding: 0;
  max-width: none;
}
body.with-sidebar > article { padding: 48px 32px 96px; max-width: 72ch; min-width: 0; }
body.with-sidebar aside.bundle-nav {
  position: sticky;
  top: 0;
  height: 100vh;
  overflow-y: auto;
  background: var(--code-bg);
  border-right: 1px solid var(--border);
  padding: 24px 16px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, sans-serif;
  font-size: 0.9em;
}
.bundle-tree-heading {
  font-size: 0.7em;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--fg-muted);
  margin: 0 0 0.6em;
}
.bundle-tree ol { list-style: none; padding: 0; margin: 0; }
.bundle-tree li { margin-bottom: 0.25em; }
.bundle-tree a {
  display: block;
  padding: 0.25em 0.5em;
  border-radius: 3px;
  text-decoration: none;
  color: var(--fg);
}
.bundle-tree a:hover { background: var(--quote-border); }
.bundle-tree li.current a {
  background: var(--accent);
  color: var(--bg);
  font-weight: 500;
}
@media (max-width: 720px) {
  body.with-sidebar { grid-template-columns: 1fr; }
  body.with-sidebar aside.bundle-nav {
    position: static;
    height: auto;
    border-right: none;
    border-bottom: 1px solid var(--border);
  }
}
@media print {
  body.with-sidebar aside.bundle-nav { display: none; }
  body.with-sidebar { grid-template-columns: 1fr; }
  body.with-sidebar > article { padding: 0; }
}
`;

/**
 * Root note → `index.html` at the bundle root.
 * Other notes keep their source-relative path with `.md` → `.html`.
 * This pairs with note-html's `follow-to-file` rewriter, which turns
 * `[[other]]` into `<a href="other.html">` — the same shape relative
 * to the emitting file, regardless of depth.
 */
function outputPathFor(note: ExportPlanFile, rootNote: ExportPlanFile): string {
  if (note.relativePath === rootNote.relativePath) return 'index.html';
  return note.relativePath.replace(/\.md$/i, '.html');
}

/**
 * Add a "References →" footer link in each note that actually cited
 * something, pointing at the bundle's `references.html`. The href is
 * computed relative to the emitting note so deep-nested notes still
 * resolve cleanly. Suppressed when the note has no citations — most
 * pages in a bundle don't, so an always-on link would be visual noise.
 */
function appendBundleReferenceLink(
  body: string,
  note: ExportPlanFile,
  rootNote: ExportPlanFile,
  hasCites: boolean,
): string {
  if (!hasCites) return body;
  const relPath = note.relativePath === rootNote.relativePath
    ? 'references.html'
    : '../'.repeat(note.relativePath.split('/').length - 1) + 'references.html';
  return `${body}\n<p class="bundle-refs-link"><a href="${relPath}">References →</a></p>`;
}
