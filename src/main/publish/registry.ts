/**
 * Exporter registry (#246).
 *
 * Each exporter registers once at startup with a stable id. The pipeline
 * looks up by id when `runExporter` is called; the export-menu UI (#282)
 * reads the registry to populate menu items, filtering by the
 * `accepts(input)` check so exporters that can't handle a given input
 * shape don't appear.
 */

import type { Exporter, ExportInput } from './types';

const exporters = new Map<string, Exporter>();

export function registerExporter(exporter: Exporter): void {
  exporters.set(exporter.id, exporter);
}

export function getExporter(id: string): Exporter | null {
  return exporters.get(id) ?? null;
}

/** Every registered exporter, in insertion order — useful for menu population. */
export function listExporters(): Exporter[] {
  return [...exporters.values()];
}

/** Only the exporters that can handle this input — drives the menu's dynamic contents. */
export function exportersFor(input: ExportInput): Exporter[] {
  return listExporters().filter((e) => e.accepts(input));
}

/** Exposed for tests to reset state between cases. */
export function _clearRegistry(): void {
  exporters.clear();
}
