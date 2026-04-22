/**
 * Single-note PDF exporter (#249) — runs the note through the HTML
 * exporter (#248) and rasterises the resulting HTML via Electron's
 * off-screen `printToPDF`. Selectable, searchable PDF text; images
 * and syntax highlighting carry over from the shared HTML shell.
 *
 * Page size defaults from the OS locale (Letter for en-US / en-CA,
 * A4 elsewhere). Other page-setup knobs (margins, orientation,
 * scale, header/footer) ship with sensible defaults; a follow-up
 * will expose them in the preview dialog.
 */

import { app } from 'electron';
import { noteHtmlExporter } from '../note-html';
import type { Exporter, ExportOutput } from '../../types';
import { resolveRenderOptions, toPrintToPdfArgs } from './options';
import { renderPdfFromHtml } from './electron-render';

export const notePdfExporter: Exporter = {
  id: 'note-pdf',
  label: 'Note as PDF',
  accepts: (input) => input.kind === 'single-note',
  acceptedKinds: ['single-note'],
  async run(plan) {
    const notes = plan.inputs.filter((f) => f.kind === 'note');
    if (notes.length === 0) {
      return { files: [], summary: 'Nothing to export.' };
    }
    // Ticket scopes this to single-note. Multi-note PDF bundling is a
    // different UX (combining pages, cross-links, TOC) that belongs to
    // the note-tree export (#251).
    if (notes.length > 1) {
      return {
        files: [],
        summary: 'PDF export supports one note at a time; use the Note-tree exporter for multi-note bundles.',
      };
    }
    const note = notes[0];

    // Reuse the HTML exporter's output as our PDF input. Force
    // inline-base64 so the off-screen window doesn't need filesystem
    // access to resolve image references.
    const htmlOutput = await noteHtmlExporter.run({
      ...plan,
      inputs: [note],
      assetPolicy: 'inline-base64',
    });
    const htmlFile = htmlOutput.files[0];
    if (!htmlFile || typeof htmlFile.contents !== 'string') {
      return { files: [], summary: 'HTML preflight produced no content.' };
    }

    const renderOptions = resolveRenderOptions(app.getLocale(), { title: note.title });
    const args = toPrintToPdfArgs(renderOptions);
    const pdf = await renderPdfFromHtml(htmlFile.contents, args);

    const files: ExportOutput['files'] = [
      {
        path: basenamePdf(note.relativePath),
        contents: pdf,
      },
    ];
    return { files, summary: `Exported "${note.title}" as PDF.` };
  },
};

function basenamePdf(relativePath: string): string {
  const base = relativePath.split('/').pop() ?? relativePath;
  return base.replace(/\.md$/i, '.pdf');
}
