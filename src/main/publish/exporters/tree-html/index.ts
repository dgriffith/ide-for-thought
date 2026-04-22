/**
 * Note-tree HTML bundle exporter (#251).
 *
 * Given the ExportPlan of a tree-mode resolve — root note + its
 * transitive wiki-link closure — render every note as HTML using the
 * same pipeline as #248's note-html exporter, but with link resolution
 * forced to `follow-to-file` and the root renamed to `index.html`.
 * Cross-links inside the bundle resolve relative to each page.
 *
 * Deferred to follow-up tickets: shared external stylesheet, sidebar
 * navigation, consolidated bibliography (needs #247), manual
 * deselection of notes in the preview dialog.
 */

import { renderNoteBody, inlineImages } from '../note-html/render';
import { wrapHtml } from '../note-html/shell';
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

    const files: ExportOutput['files'] = [];
    for (const note of notes) {
      const rawBody = renderNoteBody(note, bundlePlan);
      const body = await inlineImages(rawBody, note, rootPath, bundlePlan.assetPolicy);
      const html = wrapHtml({ title: note.title, body });
      files.push({
        path: outputPathFor(note, rootNote),
        contents: html,
      });
    }

    const excluded = plan.excluded.length;
    const summary = excluded > 0
      ? `Bundle of ${files.length} note${files.length === 1 ? '' : 's'} (${excluded} excluded).`
      : `Bundle of ${files.length} note${files.length === 1 ? '' : 's'}.`;
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
