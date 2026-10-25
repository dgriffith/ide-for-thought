/**
 * Where a sweep gets the plugins' inspections written as code (#2831): a slot
 * `plugin-inspections.ts` fills at startup (`installPluginInspections`, from
 * `main.ts`). `project-context.ts` and `register-graph.ts` read it rather
 * than importing that module, which reaches the worker host and the plugin
 * sessions — and those reach `project-context.ts`, a cycle.
 */
import type { PluginCodeCheck } from './graph/health-check-state';
import type { PluginInspectionDef } from '../shared/inspections';

let checks: () => readonly PluginCodeCheck[] = () => [];
let defs: () => readonly PluginInspectionDef[] = () => [];

/** Fill the slot; `null` empties it. */
export function setPluginCodeChecks(source: { checks: () => readonly PluginCodeCheck[]; defs: () => readonly PluginInspectionDef[] } | null): void {
  checks = source?.checks ?? (() => []);
  defs = source?.defs ?? (() => []);
}

/** The enabled plugins' code checks, as a sweep runs them (`HealthCheckDeps.pluginCodeChecks`). */
export const pluginCodeChecks = (): readonly PluginCodeCheck[] => checks();

/** …and as Settings → Inspections lists them. */
export const pluginCodeInspectionDefs = (): readonly PluginInspectionDef[] => defs();
