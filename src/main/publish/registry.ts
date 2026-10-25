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

let extraExporters: () => readonly Exporter[] = () => [];

/**
 * Exporters from outside the source — plugins' (#2648), wired by the
 * composition root (`publish/` doesn't import `plugins/`). Asked for on every
 * lookup, so a plugin turned off is gone at once; a built-in keeps its id.
 */
export function setExtraExporters(provider: (() => readonly Exporter[]) | null): void {
  extraExporters = provider ?? (() => []);
}

export function getExporter(id: string): Exporter | null {
  return exporters.get(id) ?? listExporters().find((e) => e.id === id) ?? null;
}

/** Every registered exporter, in insertion order, then the plugins' — useful for menu population. */
export function listExporters(): Exporter[] {
  return [...exporters.values(), ...extraExporters().filter((e) => !exporters.has(e.id))];
}

/** The family `exporter` is in: a built-in one, or the plugin exporter's own. */
export function exportGroupOf(exporter: Exporter): ExportGroupMeta {
  if (exporter.groupMeta) return exporter.groupMeta;
  const group = EXPORT_GROUPS[exporter.group as keyof typeof EXPORT_GROUPS] as ExportGroupMeta | undefined;
  if (!group) throw new Error(`Exporter "${exporter.id}" is in no export group.`);
  return group;
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
  const byGroup = new Map<string, ExportGroupListing>();
  for (const e of listExporters()) {
    const listing = byGroup.get(e.group);
    if (listing) listing.exporterIds.push(e.id);
    // A built-in exporter naming no group is left out, as it always was.
    else if (e.groupMeta ?? Object.hasOwn(EXPORT_GROUPS, e.group)) byGroup.set(e.group, { group: exportGroupOf(e), exporterIds: [e.id] });
  }
  return [...byGroup.values()].sort((a, b) => a.group.order - b.group.order);
}

/** Exposed for tests to reset state between cases. */
export function _clearRegistry(): void {
  exporters.clear();
}
