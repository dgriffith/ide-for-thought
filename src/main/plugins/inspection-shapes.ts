/**
 * Inspections from plugins (#2642): a plugin's `inspections/*.ttl`, SHACL
 * shapes read by `graph/shacl/shapes.ts` and run with Minerva's own checks.
 *
 * A file that breaks a rule — not Turtle, a query that isn't a SELECT or an
 * ASK, a shape with no target, a bad severity — is refused on its own and
 * reported; the plugin's other files still load. Each shape's type is
 * `plugin:<id>/<shape name>`, so two plugins can't collide, and it gets a
 * switch in Settings → Inspections like a built-in check.
 *
 * Read synchronously and memoized on the plugin scan's version, as themes
 * are: a sweep runs on a debounce after every save, and asks for these each
 * time.
 */
import fs from 'node:fs';
import { logger } from '../../shared/logger';
import type { PluginInspectionDef } from '../../shared/inspections';
import { MAX_SHAPES_FILE_BYTES, parseShapesFile } from '../graph/shacl/shapes';
import type { PluginShapesFile } from '../graph/health-check-state';
import { contributionsTo, loadedPluginScan, pluginScanVersion } from './registry';

export interface PluginInspections {
  files: PluginShapesFile[];
  catalog: PluginInspectionDef[];
  problems: Array<{ plugin: string; file: string; problem: string }>;
}

let memo: { version: number; value: PluginInspections } | null = null;

/** The enabled plugins' inspection shapes, read. */
export function pluginInspections(): PluginInspections {
  const version = pluginScanVersion();
  if (memo?.version === version) return memo.value;
  const value: PluginInspections = { files: [], catalog: [], problems: [] };
  for (const { plugin, contribution } of contributionsTo(loadedPluginScan(), 'inspections')) {
    const { id, name } = plugin.manifest;
    const refuse = (problem: string) => {
      value.problems.push({ plugin: id, file: contribution.path, problem });
      logger('plugins').warn(`${id}: inspections ${contribution.path} skipped: ${problem}`);
    };
    let text: string;
    try {
      if (fs.statSync(contribution.absolutePath).size > MAX_SHAPES_FILE_BYTES) { refuse(`it's over ${MAX_SHAPES_FILE_BYTES} bytes`); continue; }
      text = fs.readFileSync(contribution.absolutePath, 'utf-8');
    } catch (e) {
      refuse(`it couldn't be read (${(e as NodeJS.ErrnoException).code ?? 'error'})`);
      continue;
    }
    const read = parseShapesFile(text, { kind: 'plugin', id, name });
    if (!read.ok) { for (const p of read.problems) refuse(p); continue; }
    // A shape another of this plugin's files already declared is that file's.
    const taken = new Set(value.catalog.map((c) => c.type));
    const clash = read.file.checks.find((c) => taken.has(c.type));
    if (clash) { refuse(`the shape ${clash.type} is already declared in another of its files`); continue; }
    value.files.push({ id: `plugin:${id}/${contribution.path}`, file: read.file });
    for (const c of read.file.checks) {
      value.catalog.push({ type: c.type, label: c.label, description: c.description, group: c.group, severity: c.severity, plugin: { id, name } });
    }
  }
  memo = { version, value };
  return value;
}

/** The enabled plugins' shapes files: what a health-check sweep runs with theirs (`HealthCheckDeps.pluginShapes`). */
export function pluginInspectionFiles(): PluginShapesFile[] {
  return pluginInspections().files;
}
