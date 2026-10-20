/**
 * Apply a plugin change to the running app, without a restart (#2634).
 *
 * Composition-root work, so it lives here and not in `plugins/`: a change
 * touches skills, saved queries, templates, CSL, object types and the graph
 * of every open thoughtbase, and every window. After an install, toggle or
 * removal — or an edit under `~/.minerva/plugins/` the watcher noticed —
 * `applyPluginChange` re-reads the plugins and brings each of those in line:
 *
 * - skills re-registered, and the native menu rebuilt (it lists skills and
 *   saved queries);
 * - each open thoughtbase's citation assets dropped, and its notes
 *   re-indexed when the plugins' object types changed — a removed type's
 *   `rdf:type` triples go with it, so nothing is left behind in the graph;
 * - the extension catalog refreshed, with the plugins' provenance;
 * - `plugins:changed` sent to every window, whose stores refresh the skill
 *   registry, the type list and Settings → Plugins.
 *
 * Changes run one at a time: a watcher event that lands while a toggle is
 * being applied waits its turn rather than interleaving with it. And an
 * apply that finds nothing changed since the last one does nothing.
 */
import { BrowserWindow } from 'electron';
import { Channels } from '../shared/channels';
import { logger } from '../shared/logger';
import type { PluginScan } from '../shared/plugins/format';
import fs from 'node:fs/promises';
import path from 'node:path';
import { reconcilePluginServers } from './mcp-servers/registry';
import { activePluginsDir, contributionsTo, getPluginInventory, getPluginScan, reloadPluginScan } from './plugins/registry';
import { watchPluginsDir } from './plugins/watch';
import { reloadAndRegisterSkills } from './skills/register';
import { invalidateSavedQueriesCache } from './saved-queries';
import { rebuildMenu } from './menu';
import { activeProjects, getProjectContext, refreshOpenExtensionCatalogs } from './project-context';
import { indexAllNotes } from './graph';
import { invalidateCitationAssets } from './citations/assets-cache';
import { syncCorePlugins } from './core-plugins';
import { closeStalePluginSessions } from './plugin-sessions';
import { readCorePluginStates } from './plugins/core';

/** What the plugins' object types are, as a string: compared before and after. */
function typesFingerprint(scan: PluginScan): string {
  return contributionsTo(scan, 'object-types')
    .map(({ plugin, contribution }) => `${plugin.manifest.id}@${plugin.manifest.version}:${contribution.path}`)
    .sort()
    .join('\n');
}

let queue: Promise<void> = Promise.resolve();
let lastApplied: string | null = null;

/** Re-read the plugins and apply what changed everywhere. Resolves when done. */
export function applyPluginChange(): Promise<void> {
  const run = queue.then(apply, apply);
  // Not a swallow: whoever asked for `run` gets its rejection. The queue only
  // needs to go on to the next change either way.
  queue = run.catch(() => undefined);
  return run;
}

/** Make a change to the plugins (install, toggle, remove), then apply it. */
export async function changePlugins<T>(op: () => Promise<T>): Promise<T> {
  const result = await op();
  await applyPluginChange();
  return result;
}

/**
 * Watch the plugins folder; any change there applies itself. The app's own
 * changes are seen too — and cost one fingerprint, because an apply that
 * finds nothing different from the last one does nothing. That's what keeps
 * an install from re-indexing twice, without ever dropping an outside edit
 * that happens to land just after one made in the app.
 */
export function startPluginsWatcher(dir: string): () => void {
  return watchPluginsDir(dir, () => {
    void applyPluginChange().catch((e: unknown) => logger('plugins').error('applying a plugin change failed:', e));
  });
}

/**
 * Everything an apply depends on, as one string: each installed plugin's id,
 * version and whether it's on, its contributions with their files' size and
 * modification time (so an edit to a skill file counts), and the refused.
 */
async function fingerprint(): Promise<string> {
  const inv = await getPluginInventory();
  const lines: string[] = [];
  // A core plugin's toggle is a change too, though no folder moved (#2820).
  for (const [id, on] of readCorePluginStates(activePluginsDir())) lines.push(`core ${id} ${on ? 'on' : 'off'}`);
  for (const { plugin, record } of inv.installed) {
    lines.push(`${plugin.manifest.id}@${plugin.manifest.version} ${record.enabled ? 'on' : 'off'}`);
    // Servers are declared in plugin.json itself, not in contributed files.
    if (plugin.manifest.mcpServers) lines.push(`  mcp ${JSON.stringify(plugin.manifest.mcpServers)}`);
    for (const c of plugin.contributions) {
      let stamp = 'missing';
      try {
        const st = await fs.stat(c.kind === 'folder' ? path.join(c.absolutePath, 'SKILL.md') : c.absolutePath);
        stamp = `${st.size}:${st.mtimeMs}`;
      } catch { /* gone since the scan: the stamp says so */ }
      lines.push(`  ${c.point} ${c.path} ${stamp}`);
    }
  }
  for (const e of inv.errors) lines.push(`refused ${e.folder}: ${e.problems.join(' ')}`);
  return lines.join('\n');
}

async function apply(): Promise<void> {
  const before = typesFingerprint(await getPluginScan());
  const after = await reloadPluginScan();
  const now = await fingerprint();
  if (now === lastApplied) return; // nothing changed — the echo of a change already applied
  lastApplied = now;
  const typesChanged = typesFingerprint(after) !== before;

  // Core plugins first: what one wires up (a registry entry, a handler) may be
  // what the steps below read.
  syncCorePlugins();
  await reloadAndRegisterSkills();
  // A gone or changed plugin's MCP servers stop and a returning approved one starts (#2646); its views' sessions close (#2825).
  await reconcilePluginServers();
  closeStalePluginSessions();
  invalidateSavedQueriesCache();
  rebuildMenu();

  for (const rootPath of activeProjects()) {
    const ctx = getProjectContext(rootPath);
    if (!ctx) continue;
    invalidateCitationAssets(ctx);
    // A type added, removed or changed means every note's typing may have:
    // the full rebuild reloads the catalog, re-materializes the classes and
    // re-derives each note's `rdf:type`. Plugin changes are rare, and a
    // half-updated graph is the residue #2634 rules out.
    if (typesChanged) {
      try {
        await indexAllNotes(ctx);
      } catch (e) {
        logger('plugins').error(`re-indexing ${rootPath} after a plugin change failed:`, e);
      }
    }
  }
  refreshOpenExtensionCatalogs();

  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(Channels.PLUGINS_CHANGED);
  }
}
