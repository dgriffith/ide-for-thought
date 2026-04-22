/**
 * Single-note HTML exporter (#248).
 *
 * Renders each included note to a standalone HTML file under the output
 * directory. Single-note scope is the canonical use; the exporter also
 * works at folder / project scope (one HTML file per note, linked per
 * the plan's linkPolicy when `follow-to-file` is chosen).
 */

import { renderNoteBody, inlineImages } from './render';
import { wrapHtml } from './shell';
import type { Exporter, ExportOutput } from '../../types';

export const noteHtmlExporter: Exporter = {
  id: 'note-html',
  label: 'Note as HTML',
  // Accepts every scope; the per-note rendering is identical, and
  // `follow-to-file` works best when there's more than one note.
  accepts: () => true,
  async run(plan) {
    const rootPath = plan.rootPath ?? '';
    const files: ExportOutput['files'] = [];
    for (const f of plan.inputs) {
      if (f.kind !== 'note') continue;
      const rawBody = renderNoteBody(f, plan);
      const body = await inlineImages(rawBody, f, rootPath, plan.assetPolicy);
      const html = wrapHtml({ title: f.title, body });
      files.push({
        path: f.relativePath.replace(/\.md$/i, '.html'),
        contents: html,
      });
    }
    const summary = files.length === 1
      ? `Exported "${plan.inputs[0]?.title ?? 'note'}" as HTML.`
      : `${files.length} notes exported as HTML${plan.excluded.length > 0 ? ` (${plan.excluded.length} excluded)` : ''}.`;
    return { files, summary };
  },
};
