/**
 * Note-tree HTML bundle exporter (#251).
 *
 * Given the ExportPlan of a tree-mode resolve — root note + its
 * transitive wiki-link closure — render every note as HTML using the
 * same pipeline as #248's note-html exporter, but with link resolution
 * forced to `follow-to-file` and the root renamed to `index.html`.
 * Cross-links inside the bundle resolve relative to each page.
 *
 * Each note gets its own `CitationRenderer` so per-note footnote
 * numbering is local (Chicago full-note, etc.); cited-id sets are
 * unioned across notes and the merged bibliography lands in a single
 * `references.html` at the bundle root (#300).
 *
 * Deferred to follow-up tickets: shared external stylesheet, sidebar
 * navigation (#292), manual deselection of notes (#293).
 */

import { renderNoteBody, inlineImages } from '../note-html/render';
import { wrapHtml } from '../note-html/shell';
import { renderFootnotesSection } from '../note-html';
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
      const html = wrapHtml({ title: note.title, body });
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
          contents: wrapHtml({ title: heading, body: refsBody }),
        });
      }
    }

    const excluded = plan.excluded.length;
    const summary = excluded > 0
      ? `Bundle of ${files.length} file${files.length === 1 ? '' : 's'} (${excluded} excluded).`
      : `Bundle of ${files.length} file${files.length === 1 ? '' : 's'}.`;
    return { files, summary };
  },
};

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
