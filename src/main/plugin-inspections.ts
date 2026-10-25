/**
 * Plugin inspections written as code (#2831, design `docs/plugin-code.md` →
 * *Inspections from code*): a health check a SHACL shape can't say, run by a
 * handler in the plugin's worker host (#2830), beside the built-in and SHACL
 * checks in every sweep.
 *
 * - Main runs the check's declared query, if it has one, and hands the
 *   handler the results; the notes they name are what it may read.
 * - **It only reads.** The call is capped at `notes:read` and `graph:query`,
 *   whatever else the plugin declares (a board that moves cards still can't
 *   write from its inspection).
 * - Its answer is checked finding by finding and turned into `Inspection`s
 *   of its one type, `plugin:<id>/<check>`.
 * - **A check that misses its deadline, throws or answers nonsense reports
 *   one finding against the plugin**, saying so, and the other checks run as
 *   usual. Unlike a SHACL check (#2874) it isn't held back afterwards: its
 *   host is stopped, so a slow check costs its own process, never main's
 *   thread, and the next sweep tries it again.
 *
 * `graph/` runs them through `HealthCheckDeps.pluginCodeChecks`; it doesn't
 * import this (or the plugins). The sweep's callers read them from the
 * `plugin-code-checks.ts` slot, filled by `installPluginInspections`.
 */
import path from 'node:path';
import { invokePluginLogic, PluginDeadlineError } from './plugin-worker-host';
import { runDeclaredPluginQuery } from './plugin-sessions';
import { activePluginInspections as allPluginInspections } from './plugins/code-plugins';
import { pluginInspections as pluginShapes } from './plugins/inspection-shapes';
import { lexicalAgentPathRefusal } from './path-containment';
import { noteUriFor } from './graph';
import { logger } from '../shared/logger';
import { setPluginCodeChecks } from './plugin-code-checks';
import type { PluginCodeCheck } from './graph/health-check-state';
import type { ProjectContext } from './project-context-types';
import type { Inspection, PluginInspectionDef } from '../shared/inspections';
import type { PluginCapability } from '../shared/plugins/capabilities';
import type { PluginInspection, PluginInspectionInput } from '../shared/plugins/format';

/** What an inspection's call may do: read, nothing else. */
export const PLUGIN_INSPECTION_CAPABILITIES: readonly PluginCapability[] = ['notes:read', 'graph:query'];
/** How long a check may run before its host is stopped. */
export const PLUGIN_INSPECTION_DEADLINE_MS = 10_000;
/** Most findings one check reports in a sweep; the rest are left out, as the built-in checks cap theirs. */
export const PLUGIN_INSPECTION_MAX_FINDINGS = 200;
const LIMITS = { message: 500, label: 200, suggestedAction: 300, node: 2000 } as const;
const FINDING_KEYS = new Set(['message', 'note', 'node', 'label', 'suggestedAction']);
const IRI = /^[a-z][a-z0-9+.-]*:\S+$/i;

/** The enabled plugins' code checks; one whose type a shape of the plugin's already has is the shape's. */
function activePluginInspections(): ReturnType<typeof allPluginInspections> {
  const shapeTypes = new Set(pluginShapes().catalog.map((c) => c.type));
  return allPluginInspections().filter(({ pluginId, inspection }) => {
    const clash = shapeTypes.has(`plugin:${pluginId}/${inspection.id}`);
    if (clash) logger('plugins').warn(`plugin ${pluginId}: inspection ${inspection.id} skipped: a shape of its has the same name`);
    return !clash;
  });
}

/** The enabled plugins' code checks, as a sweep runs them. */
export function pluginCodeChecks(): PluginCodeCheck[] {
  return activePluginInspections().map(({ pluginId, name, inspection }) => {
    const type = `plugin:${pluginId}/${inspection.id}` as const;
    return { type, run: (ctx) => runPluginInspection(ctx, { pluginId, name, inspection, type }) };
  });
}

/** The plugins' code checks as Settings lists them, beside their SHACL ones. */
export function pluginCodeInspectionDefs(): PluginInspectionDef[] {
  return activePluginInspections().map(({ pluginId, name, inspection }) => ({
    type: `plugin:${pluginId}/${inspection.id}`,
    label: inspection.label,
    description: inspection.description,
    group: 'plugins',
    severity: inspection.severity,
    plugin: { id: pluginId, name },
  }));
}

interface Check {
  pluginId: string;
  name: string;
  inspection: PluginInspection;
  type: `plugin:${string}`;
}

/** Run one check; whatever goes wrong is one finding against the plugin, never a rejection. */
export async function runPluginInspection(ctx: ProjectContext, check: Check): Promise<Inspection[]> {
  const { pluginId, name, inspection } = check;
  try {
    const query = inspection.query === undefined ? null
      : await runDeclaredPluginQuery(pluginId, ctx.rootPath, inspection.query, `inspection ${inspection.id}`);
    const input: PluginInspectionInput = { check: inspection.id, query };
    const answer = await invokePluginLogic(pluginId, inspection.run.handler, input, {
      rootPath: ctx.rootPath,
      scope: query ? Object.values(query.notes) : [],
      capabilities: PLUGIN_INSPECTION_CAPABILITIES,
      deadlineMs: PLUGIN_INSPECTION_DEADLINE_MS,
    });
    return checkedFindings(ctx, check, answer);
  } catch (e) {
    logger('plugins').warn(`plugin ${pluginId}: inspection ${inspection.id} failed:`, e);
    const why = e instanceof PluginDeadlineError
      ? `didn't finish in ${PLUGIN_INSPECTION_DEADLINE_MS / 1000} s, so it was stopped`
      : `failed: ${(e instanceof Error ? e.message : String(e)).slice(0, LIMITS.message)}`;
    return [{
      id: `${check.type}-failed`,
      type: check.type,
      severity: 'warning',
      nodeUri: `minerva-plugin://${pluginId}/`,
      nodeLabel: name,
      message: `${name}'s "${inspection.label}" check ${why}. Its findings are missing from this run.`,
    }];
  }
}

/** A handler's answer as findings of the check's type; anything else is the plugin's error. */
export function checkedFindings(ctx: ProjectContext, check: Check, answer: unknown): Inspection[] {
  const bad = (why: string) => new Error(`it returned something that isn't a list of findings (${why})`);
  if (typeof answer !== 'object' || answer === null || Array.isArray(answer)) throw bad('not an object');
  const { findings, ...rest } = answer as Record<string, unknown>;
  if (Object.keys(rest).length > 0) throw bad(`unknown field ${JSON.stringify(Object.keys(rest)[0])}`);
  if (!Array.isArray(findings)) throw bad('"findings" must be a list');
  if (findings.length > PLUGIN_INSPECTION_MAX_FINDINGS) {
    logger('plugins').info(`plugin ${check.pluginId}: inspection ${check.inspection.id} found ${findings.length}; showing ${PLUGIN_INSPECTION_MAX_FINDINGS}`);
  }
  return findings.slice(0, PLUGIN_INSPECTION_MAX_FINDINGS).map((f: unknown, i): Inspection => {
    if (typeof f !== 'object' || f === null || Array.isArray(f)) throw bad(`findings[${i}] is not an object`);
    const r = f as Record<string, unknown>;
    const extra = Object.keys(r).find((k) => !FINDING_KEYS.has(k));
    if (extra) throw bad(`findings[${i}] has an unknown field ${JSON.stringify(extra)}`);
    const text = (key: keyof typeof LIMITS, required = false): string | undefined => {
      const v = r[key];
      if (v === undefined && !required) return undefined;
      if (typeof v !== 'string' || v.trim() === '' || v.length > LIMITS[key]) throw bad(`findings[${i}].${key} must be text of at most ${LIMITS[key]} characters`);
      return v.trim();
    };
    const message = text('message', true)!;
    const node = text('node');
    if (node !== undefined && !IRI.test(node)) throw bad(`findings[${i}].node must be an IRI`);
    const note = r.note;
    if (note !== undefined && (typeof note !== 'string' || note === '' || lexicalAgentPathRefusal(note))) throw bad(`findings[${i}].note must be a note's path`);
    if (note === undefined && node === undefined) throw bad(`findings[${i}] must name a "note" or a "node"`);
    const label = text('label');
    const suggestedAction = text('suggestedAction');
    const notePath = note;
    return {
      id: `${check.type}-${i}`,
      type: check.type,
      severity: check.inspection.severity,
      nodeUri: node ?? noteUriFor(ctx, notePath!) ?? notePath!,
      nodeLabel: label ?? (notePath ? path.posix.basename(notePath).replace(/\.[^.]+$/, '') : node!.replace(/^.*[#/:]/, '')),
      message,
      ...(suggestedAction ? { suggestedAction } : {}),
      ...(notePath ? { notePath } : {}),
    };
  });
}

/** Fill the sweep's slot with the plugins' code checks. At startup. */
export function installPluginInspections(): void {
  setPluginCodeChecks({ checks: pluginCodeChecks, defs: pluginCodeInspectionDefs });
}
