/**
 * Publish-module entry point (#246).
 *
 * `registerBuiltinExporters()` slots every bundled exporter into the
 * registry. Called once at app-ready from `main.ts`, right after
 * `registerBuiltinExecutors()`.
 */

import { registerExporter } from './registry';
import { markdownExporter } from './exporters/markdown';
import { noteHtmlExporter } from './exporters/note-html';
import { notePdfExporter } from './exporters/note-pdf';

export function registerBuiltinExporters(): void {
  registerExporter(markdownExporter);
  registerExporter(noteHtmlExporter);
  registerExporter(notePdfExporter);
}

export * from './types';
export { resolvePlan, runExporter } from './pipeline';
export { listExporters, exportersFor, getExporter } from './registry';
export { runExport, type RunExportInput, type RunExportResult } from './run-export';
