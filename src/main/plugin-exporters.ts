/**
 * Plugin exporters (#2648, design `docs/plugin-code.md` → *Exporters*): an
 * export format a plugin writes, by a handler in its worker host (#2830).
 * Data in, data out:
 *
 * - main resolves the plan the way every exporter's is resolved (exclusion
 *   rules, the dialog's choices) and hands the handler each note as Minerva
 *   renders it for export (`input: "html"`) or as written (`"markdown"`),
 *   with no notes in scope — what it's given is all it gets;
 * - the handler returns files; each path is checked here (relative, inside
 *   the output folder, no dot-segments) and so is each body, and anything
 *   else is the plugin's error;
 * - `runExport` writes them into the folder the user chose, as for any
 *   exporter. The plugin never touches the disk.
 *
 * Each exporter is its own Export menu family (`plugin:<id>/<exporter>`).
 * They join `publish/registry.ts` through `setExtraExporters`, wired at
 * startup by `installPluginExporters` and read on every lookup.
 */
import path from 'node:path';
import { invokePluginLogic } from './plugin-worker-host';
import { callPluginTool } from './plugin-mcp-tools';
import { activePluginExporters, codePluginIdentity } from './plugins/code-plugins';
import { PluginCallError } from './plugins/broker';
import { setExtraExporters } from './publish/registry';
import { renderNoteBody } from './publish/exporters/note-html/render';
import { appendCitationsTail } from './publish/exporters/note-html';
import { createRendererSessions } from './publish/csl';
import { resolveDisplayName } from './project-config';
import { stripFrontmatter } from '../shared/frontmatter-strip';
import { PLUGIN_MESSAGE_LIMIT_BYTES } from '../shared/plugins/api';
import type { Exporter, ExportOutput, ExportPlan } from './publish/types';
import type { PluginExporter, PluginExportNote, PluginExportPlan, PluginExportScope } from '../shared/plugins/format';

/** How long a writer may run: longer than a command's, since it is handed every note. */
export const PLUGIN_EXPORT_DEADLINE_MS = 30_000;
/** Most files one export may write, and the longest summary. */
export const PLUGIN_EXPORT_MAX_FILES = 256;
const SUMMARY_MAX = 200;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** Run plugin `pluginId`'s `exporter` on `plan`. */
export async function exportWithPlugin(pluginId: string, exporter: PluginExporter, plan: ExportPlan): Promise<ExportOutput> {
  const identity = codePluginIdentity(pluginId);
  if (!identity) throw new PluginCallError(`"${pluginId}" is not an enabled plugin with code.`);
  const rootPath = plan.rootPath ?? '';
  const input = await buildPluginPlan(exporter, plan);
  if (input.notes.length === 0) throw new PluginCallError(`There are no notes to export as ${exporter.label}.`);
  const size = Buffer.byteLength(JSON.stringify(input));
  // Leave room for the call's envelope inside the one message it travels in.
  if (size > PLUGIN_MESSAGE_LIMIT_BYTES - 1024) {
    throw new PluginCallError(`${identity.name} can be handed about 1 MB of notes at once; these are ${(size / 1024 / 1024).toFixed(1)} MB. Export fewer notes.`);
  }
  // A handler in its worker, or a tool on its own MCP server (#2880), handed the same plan.
  const answer = 'handler' in exporter.write
    ? await invokePluginLogic(pluginId, exporter.write.handler, input, { rootPath, scope: [], deadlineMs: PLUGIN_EXPORT_DEADLINE_MS })
    : await callPluginTool(identity.name, pluginId, exporter.write.mcpTool, { ...input });
  return checkedExport(identity.name, exporter.label, answer);
}

/** The notes in `plan`, as `exporter` asked for them. */
export async function buildPluginPlan(exporter: PluginExporter, plan: ExportPlan): Promise<PluginExportPlan> {
  const files = plan.inputs.filter((f) => f.kind === 'note');
  // One citation session per note, as the HTML exporter does (#2408).
  const sessions = exporter.input === 'html' ? createRendererSessions(plan.citations) : null;
  const notes: PluginExportNote[] = [];
  for (const f of files) {
    const base = { path: f.relativePath, title: f.title, frontmatter: f.frontmatter };
    if (exporter.input === 'markdown') {
      notes.push({ ...base, markdown: stripFrontmatter(f.content) });
      continue;
    }
    const renderer = sessions!.next();
    const body = await renderNoteBody(f, plan, renderer);
    notes.push({ ...base, html: renderer ? appendCitationsTail(body, renderer) : body });
  }
  return { exporter: exporter.id, scope: plan.inputKind as PluginExportScope, title: exportTitle(plan, notes), notes };
}

/** A name for the whole export. */
function exportTitle(plan: ExportPlan, notes: readonly PluginExportNote[]): string {
  const rootName = plan.rootPath ? resolveDisplayName(plan.rootPath) : 'Export';
  if (plan.inputKind === 'single-note' || plan.inputKind === 'tree') return notes[0]?.title ?? rootName;
  if (plan.inputKind === 'folder') {
    const dirs = notes.map((n) => path.posix.dirname(n.path).split('/').filter((s) => s !== '.'));
    const common = dirs.reduce((acc, d) => acc.filter((s, i) => d[i] === s), dirs[0] ?? []);
    return common.at(-1) ?? rootName;
  }
  return rootName;
}

/** A path a writer may name: relative, `/`-separated, no `..`, no dot-segment. */
function safeOutputPath(p: unknown): p is string {
  if (typeof p !== 'string' || p.length === 0 || p.length > 200) return false;
  if (p.includes('\\') || p.includes('\0') || p.startsWith('/') || /^[A-Za-z]:/.test(p)) return false;
  return p.split('/').every((s) => s !== '' && s !== '..' && !s.startsWith('.'));
}

/** A handler's answer as files to write; anything else is the plugin's error. */
export function checkedExport(name: string, label: string, answer: unknown): ExportOutput {
  const bad = (why: string) => new PluginCallError(`${name}'s ${label} exporter returned something Minerva can't write: ${why}.`);
  if (typeof answer !== 'object' || answer === null || Array.isArray(answer)) throw bad('not an object');
  const { files, summary, ...rest } = answer as Record<string, unknown>;
  const unknown = Object.keys(rest);
  if (unknown.length > 0) throw bad(`unknown field ${JSON.stringify(unknown[0])}`);
  if (!Array.isArray(files) || files.length === 0) throw bad('"files" must be a non-empty list');
  if (files.length > PLUGIN_EXPORT_MAX_FILES) throw bad(`it has ${files.length} files; at most ${PLUGIN_EXPORT_MAX_FILES}`);
  if (summary !== undefined && (typeof summary !== 'string' || summary.length > SUMMARY_MAX)) throw bad(`"summary" must be at most ${SUMMARY_MAX} characters`);

  const seen = new Set<string>();
  const out: ExportOutput['files'] = files.map((f: unknown, i) => {
    if (typeof f !== 'object' || f === null || Array.isArray(f)) throw bad(`files[${i}] is not an object`);
    const { path: p, text, base64, ...extra } = f as Record<string, unknown>;
    if (Object.keys(extra).length > 0) throw bad(`files[${i}] has an unknown field ${JSON.stringify(Object.keys(extra)[0])}`);
    if (!safeOutputPath(p)) throw bad(`files[${i}].path ${JSON.stringify(p)} isn't a path inside the output folder`);
    // The disk may not be case-sensitive: two names one file would be is one too many.
    if (seen.has(p.toLowerCase())) throw bad(`it names ${p} twice`);
    seen.add(p.toLowerCase());
    if ((text === undefined) === (base64 === undefined)) throw bad(`files[${i}] must have exactly one of "text" and "base64"`);
    if (text !== undefined) {
      if (typeof text !== 'string') throw bad(`files[${i}].text must be a string`);
      return { path: p, contents: text };
    }
    if (typeof base64 !== 'string' || base64.length % 4 !== 0 || !BASE64.test(base64)) throw bad(`files[${i}].base64 isn't base64`);
    return { path: p, contents: new Uint8Array(Buffer.from(base64, 'base64')) };
  });
  return { files: out, summary: summary ?? `Exported ${out.length === 1 ? out[0]!.path : `${out.length} files`} with ${name}.` };
}

/** The enabled plugins' exporters, as the registry runs them. */
export function pluginExporters(): Exporter[] {
  return activePluginExporters().map(({ pluginId, exporter }, i): Exporter => {
    const group = `plugin:${pluginId}/${exporter.id}` as const;
    const scopes = [...exporter.scopes];
    return {
      id: group,
      label: exporter.label,
      group,
      // After every built-in family, in the plugins' order.
      groupMeta: { id: group, label: exporter.label, category: 'publication', order: 100 + i },
      accepts: (input) => (scopes as string[]).includes(input.kind),
      acceptedKinds: scopes,
      run: (plan) => exportWithPlugin(pluginId, exporter, plan),
    };
  });
}

/** Put the enabled plugins' exporters in the registry. At startup. */
export function installPluginExporters(): void {
  setExtraExporters(pluginExporters);
}
