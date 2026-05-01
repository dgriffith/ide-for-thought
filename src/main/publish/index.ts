/**
 * Publish-module entry point (#246).
 *
 * `registerBuiltinExporters()` slots every bundled exporter into the
 * registry. Called once at app-ready from `main.ts`, right after
 * `registerBuiltinExecutors()`.
 */

import { registerExporter } from './registry';
import { markdownExporter } from './exporters/markdown';
import { noteMarkdownExporter } from './exporters/note-markdown';
import { noteHtmlExporter } from './exporters/note-html';
import { notePdfExporter } from './exporters/note-pdf';
import { treeHtmlExporter } from './exporters/tree-html';
import { staticSiteExporter } from './exporters/static-site';
import { annotatedReadingExporter } from './exporters/annotated-reading';
import { pandocExporter } from './exporters/pandoc';
import { bibtexExporter } from './exporters/bibtex';

export function registerBuiltinExporters(): void {
  registerExporter(markdownExporter);
  registerExporter(noteMarkdownExporter);
  registerExporter(noteHtmlExporter);
  registerExporter(notePdfExporter);
  registerExporter(treeHtmlExporter);
  registerExporter(staticSiteExporter);
  registerExporter(annotatedReadingExporter);
  registerExporter(pandocExporter);
  registerExporter(bibtexExporter);
}

export * from './types';
export { resolvePlan, runExporter } from './pipeline';
export { listExporters, exportersFor, getExporter } from './registry';
export { runExport, type RunExportInput, type RunExportResult } from './run-export';
