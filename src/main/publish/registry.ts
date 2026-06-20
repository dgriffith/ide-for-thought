/**
 * Exporter registry (#246).
 *
 * Each exporter registers once at startup with a stable id. The pipeline
 * looks up by id when `runExporter` is called; the export-menu UI (#282)
 * reads the registry to populate menu items, filtering by the
 * `accepts(input)` check so exporters that can't handle a given input
 * shape don't appear.
 */

import type { Exporter, ExportInput, ExportGroupMeta } from './types';
import { EXPORT_GROUPS } from './types';

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

export interface ExportGroupListing {
  group: ExportGroupMeta;
  exporterIds: string[];
}

/**
 * Registered exporters collapsed into format families, ordered for the
 * format-first Export menu (#: export-menu-redesign). One listing per group
 * that has at least one registered exporter.
 */
export function listExportGroups(): ExportGroupListing[] {
  const byGroup = new Map<string, string[]>();
  for (const e of listExporters()) {
    const ids = byGroup.get(e.group) ?? [];
    ids.push(e.id);
    byGroup.set(e.group, ids);
  }
  return [...byGroup.entries()]
    .map(([id, exporterIds]) => ({ group: EXPORT_GROUPS[id as ExportGroupMeta['id']], exporterIds }))
    .filter((entry) => entry.group != null)
    .sort((a, b) => a.group.order - b.group.order);
}

/** Exposed for tests to reset state between cases. */
export function _clearRegistry(): void {
  exporters.clear();
}
