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
import type { CitationRenderer } from '../../csl';

/**
 * Append the rendered bibliography for everything cited in this note.
 * Emits nothing when no citations fired — skips the empty-references
 * divot in the exported HTML.
 */
function appendReferences(body: string, renderer: CitationRenderer): string {
  const bib = renderer.renderBibliography();
  if (bib.entries.length === 0) return body;
  const entries = bib.entries.map((e) => `<li>${e}</li>`).join('\n');
  return `${body}\n<section class="references">\n<h2>References</h2>\n<ol>\n${entries}\n</ol>\n</section>`;
}

export const noteHtmlExporter: Exporter = {
  id: 'note-html',
  label: 'Note as HTML',
  // Single-note HTML is the canonical use; folder / project scopes also
  // work (emits one file per note) but the tree scope belongs to the
  // dedicated tree-html exporter which handles the bundle shape.
  accepts: (input) => input.kind !== 'tree',
  acceptedKinds: ['single-note', 'folder', 'project'],
  async run(plan) {
    const rootPath = plan.rootPath ?? '';
    const notes = plan.inputs.filter((f) => f.kind === 'note');
    // Single-note scope: drop the source note's directory structure so
    // `notes/analysis/foo.md` exported to `~/Desktop` lands as
    // `~/Desktop/foo.html`, not `~/Desktop/notes/analysis/foo.html`.
    // Multi-note scope preserves the tree so `follow-to-file` rewrites
    // keep working as relative links.
    const flatten = notes.length === 1;
    const files: ExportOutput['files'] = [];
    for (const f of notes) {
      // One renderer per note so each page gets its own References
      // section listing only what it cited. Tree-level consolidation
      // is a follow-up; this is the simple, correct v1.
      const renderer = plan.citations?.createRenderer();
      const rawBody = renderNoteBody(f, plan, renderer);
      const withReferences = renderer ? appendReferences(rawBody, renderer) : rawBody;
      const body = await inlineImages(withReferences, f, rootPath, plan.assetPolicy);
      const html = wrapHtml({ title: f.title, body });
      files.push({
        path: flatten ? basenameHtml(f.relativePath) : f.relativePath.replace(/\.md$/i, '.html'),
        contents: html,
      });
    }
    const summary = files.length === 1
      ? `Exported "${plan.inputs[0]?.title ?? 'note'}" as HTML.`
      : `${files.length} notes exported as HTML${plan.excluded.length > 0 ? ` (${plan.excluded.length} excluded)` : ''}.`;
    return { files, summary };
  },
};

function basenameHtml(relativePath: string): string {
  const base = relativePath.split('/').pop() ?? relativePath;
  return base.replace(/\.md$/i, '.html');
}
