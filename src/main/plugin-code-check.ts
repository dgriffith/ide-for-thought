/**
 * `minerva plugin check`'s code stage (#2833): a plugin's code, run for real
 * in a sandboxed worker host, against each thoughtbase the check copied. A
 * call outside the capabilities it declares fails the plugin.
 *
 * It lives in the app's bundle, not the CLI's: the CLI is Electron-free
 * (`tests/cli/electron-free.test.ts`), and a worker host is a Chromium
 * renderer. Run as the CLI (`--minerva-cli`), the app offers this function on
 * `PLUGIN_CODE_STAGE_GLOBAL` (`cli-mode.ts`, which loads it only when it's
 * called), and `plugin check` calls it.
 * Under plain Node nothing offers it, and the stage says so.
 *
 * The app's bundle has its own copy of the plugin registry and the graph, so
 * this points both at the check's scratch folder and copies, then puts them
 * back. Each handler is called with sample inputs:
 * - a command's (with a `handler`): the first note, and a sentence selected;
 * - an ingestor's: a small text file of its first extension;
 * - an exporter's: the thoughtbase, or its first note;
 * - an inspection's: its query, as a sweep runs it.
 * A view or a live block is drawn in a window, so it's checked in the app.
 *
 * What fails: a call the broker refused for a capability the plugin doesn't
 * declare. What warns: a refused scope, or a handler that threw or answered
 * nonsense with these inputs, which may be the inputs' fault.
 */
import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runPluginCommand } from './plugin-commands';
import { ingestWithPlugin } from './plugin-ingestors';
import { exportWithPlugin } from './plugin-exporters';
import { runPluginInspection } from './plugin-inspections';
import { installPluginProtocol } from './plugin-protocol';
import { installGlobalWebContentsGuards, installPermissions } from './security';
import { codePluginIdentity, codePluginWorker } from './plugins/code-plugins';
import { disablePlugins, enablePlugins, loadedPluginScan, reloadPluginScan } from './plugins/registry';
import { setPluginRefusalTap, stopStaleWorkerHosts } from './plugin-worker-host';
import { disposeProject, indexAllNotes, initGraph } from './graph';
import { indexedNotePaths } from './graph/note-index';
import { resolvePlan } from './publish/pipeline';
import { projectContext } from './project-context-types';
import type { PluginCheckItem, PluginCodeStageInput } from '../shared/plugins/check';
import type { PluginRefusal } from './plugins/broker';
import { setTagLevel } from '../shared/logger';
import type { PluginCode } from '../shared/plugins/format';

/** One handler call, as the check runs it: the call, and what to call it in reports. */
interface HandlerCall {
  subject: string;
  run: () => Promise<string>;
}

const SELECTION = 'Some words a command can work on.';
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The calls to make for `code`, against the thoughtbase at `root`. */
function callsFor(pluginId: string, code: PluginCode, root: string, scratch: string): HandlerCall[] {
  const ctx = projectContext(root);
  const note = indexedNotePaths(ctx).filter((p) => p.endsWith('.md')).sort()[0] ?? null;
  const calls: HandlerCall[] = [];
  for (const c of code.commands ?? []) {
    if (!('handler' in c.run)) continue;
    calls.push({
      subject: `command ${c.id}`,
      run: async () => {
        const action = await runPluginCommand(root, pluginId, c.id, { ...(note ? { note } : {}), selection: SELECTION });
        return action.kind === 'result' && action.replaceSelection !== undefined ? 'replaces the selection' : 'ran';
      },
    });
  }
  for (const g of code.ingestors ?? []) {
    calls.push({
      subject: `ingestor ${g.id}`,
      run: async () => {
        const file = path.join(scratch, 'code-input', `sample${g.accepts.extensions[0]}`);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, 'A sample file for an ingestor to read.\n');
        const made = await ingestWithPlugin(root, pluginId, g, file);
        return `made a source, "${made.title}"`;
      },
    });
  }
  for (const x of code.exporters ?? []) {
    calls.push({
      subject: `exporter ${x.id}`,
      run: async () => {
        const kind = x.scopes.includes('project') ? 'project' as const : x.scopes[0]!;
        const plan = await resolvePlan(root, kind === 'project' ? { kind } : { kind, relativePath: note ?? '' }, {});
        const out = await exportWithPlugin(pluginId, x, plan);
        return `wrote ${out.files.length} file${out.files.length === 1 ? '' : 's'}`;
      },
    });
  }
  for (const i of code.inspections ?? []) {
    calls.push({
      subject: `inspection ${i.id}`,
      run: async () => {
        const name = codePluginIdentity(pluginId)?.name ?? pluginId;
        const found = await runPluginInspection(ctx, { pluginId, name, inspection: i, type: `plugin:${pluginId}/${i.id}` });
        const failed = found.find((f) => f.id.endsWith('-failed'));
        if (failed) throw new Error(failed.message);
        return `${found.length} finding${found.length === 1 ? '' : 's'}`;
      },
    });
  }
  return calls;
}

/** What a call's refusals and outcome make of it. */
export function verdict(subject: string, where: string, refusals: readonly PluginRefusal[], outcome: { ok: true; detail: string } | { ok: false; error: string }): PluginCheckItem {
  const at = `${subject} × ${where}`;
  const undeclared = refusals.filter((r) => r.code === 'capability');
  if (undeclared.length > 0) {
    return { stage: 'code', subject: at, status: 'fail', detail: `it called outside what it declares: ${[...new Set(undeclared.map((r) => r.message))].join(' ')}` };
  }
  const scope = refusals.filter((r) => r.code === 'scope');
  if (!outcome.ok) return { stage: 'code', subject: at, status: 'warn', detail: `with sample inputs, it failed: ${outcome.error}` };
  if (scope.length > 0) return { stage: 'code', subject: at, status: 'warn', detail: `${outcome.detail}, but asked for notes it wasn't given: ${scope[0]!.message}` };
  return { stage: 'code', subject: at, status: 'pass', detail: outcome.detail };
}

let runtimeReady: Promise<void> | null = null;

/** The pieces of the app's runtime a worker host needs, once, after `app` is ready. */
function readyRuntime(): Promise<void> {
  runtimeReady ??= app.whenReady().then(() => {
    installGlobalWebContentsGuards();
    installPermissions();
    // Worker hosts are top-level pages, so no one is allowed to frame them.
    installPluginProtocol([]);
  });
  return runtimeReady;
}

/** The code stage: every handler, against every thoughtbase. */
export async function checkPluginCode(input: PluginCodeStageInput): Promise<PluginCheckItem[]> {
  // The report is the CLI's stdout: this bundle's logger keeps off it, as the
  // CLI's own copy does (the hostile fixture makes the seams complain).
  for (const tag of ['config', 'graph', 'tables'] as const) setTagLevel(tag, 'silent');
  setTagLevel('plugins', 'warn');
  await readyRuntime();
  enablePlugins({ appVersion: input.appVersion, dir: input.pluginsDir });
  const items: PluginCheckItem[] = [];
  try {
    await reloadPluginScan();
    const manifest = loadedPluginScan().plugins.find((p) => p.manifest.id === input.pluginId)?.manifest;
    const code = manifest?.code;
    if (!code || !codePluginIdentity(input.pluginId)) {
      return [{ stage: 'code', subject: 'code', status: 'fail', detail: 'its code didn\'t load, approved, in a plugins folder' }];
    }
    if ((code.views?.length ?? 0) + (code.blocks?.length ?? 0) > 0) {
      items.push({ stage: 'code', subject: 'views and live blocks', status: 'skip', detail: 'they are drawn in a window: try them in the app' });
    }
    if (!codePluginWorker(input.pluginId)) return items;
    for (const tb of input.thoughtbases) {
      const ctx = projectContext(tb.root);
      try {
        await initGraph(ctx);
        await indexAllNotes(ctx);
        for (const call of callsFor(input.pluginId, code, tb.root, input.scratch)) {
          const refusals: PluginRefusal[] = [];
          setPluginRefusalTap((r) => refusals.push(r));
          const outcome = await call.run().finally(() => setPluginRefusalTap(null))
            .then((detail) => ({ ok: true as const, detail }), (e: unknown) => ({ ok: false as const, error: message(e) }));
          items.push(verdict(call.subject, tb.name, refusals, outcome));
        }
      } finally {
        disposeProject(ctx);
      }
    }
    if (items.every((i) => i.status === 'skip')) items.push({ stage: 'code', subject: 'logic', status: 'pass', detail: 'its logic loads; nothing it declares has a handler to call' });
    return items;
  } finally {
    disablePlugins();
    stopStaleWorkerHosts();
  }
}
