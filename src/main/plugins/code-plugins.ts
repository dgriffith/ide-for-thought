/**
 * Which plugin code is running now, as the broker sees it (#2825): an enabled
 * plugin that declares a `code` section, with the capabilities it declared.
 * Asked when a session opens and again before every call, so a plugin turned
 * off, removed or upgraded mid-session loses it at once.
 *
 * Built-in plugins count while they are active (#2820); installed ones while
 * they are in the enabled scan, which can't hold code until #2833.
 */
import { isCorePluginActive } from '../core-plugins-active';
import { corePlugin, corePlugins } from './core';
import { loadedPluginScan } from './registry';
import type { PluginIdentity } from './broker';
import type { PluginBlock, PluginCommand, PluginIngestor, PluginView } from '../../shared/plugins/format';
import type { PluginBlockSyntax } from '../../shared/live-blocks';

// The e2e harness's hostile fixture (`e2e-hooks.ts`, MINERVA_E2E only): no
// installed plugin can declare code yet, so there is no other way to drive
// the real broker from a real frame.
const e2ePlugins = new Map<string, PluginIdentity>();

/** Treat `identity` as an enabled code plugin — e2e only (`e2e-hooks.ts`). */
export function _registerCodePluginForE2E(identity: PluginIdentity): void {
  e2ePlugins.set(identity.id, identity);
}

/** The plugin `id` as it runs now, or null when it isn't enabled code. */
export function codePluginIdentity(id: string): PluginIdentity | null {
  const e2e = e2ePlugins.get(id);
  if (e2e) return e2e;
  const core = corePlugin(id);
  if (core) {
    if (!isCorePluginActive(id) || !core.manifest.code) return null;
    return { id, name: core.manifest.name, version: core.manifest.version, capabilities: core.manifest.code.capabilities };
  }
  const manifest = loadedPluginScan().plugins.find((p) => p.manifest.id === id)?.manifest;
  if (!manifest?.code) return null;
  return { id, name: manifest.name, version: manifest.version, capabilities: manifest.code.capabilities };
}

/** The global views plugin `id` draws (#2640), while it is enabled code; [] otherwise. */
export function codePluginViews(id: string): readonly PluginView[] {
  if (!codePluginIdentity(id) || e2ePlugins.has(id)) return [];
  const core = corePlugin(id);
  const manifest = core ? core.manifest : loadedPluginScan().plugins.find((p) => p.manifest.id === id)?.manifest;
  return manifest?.code?.views ?? [];
}

/** The live blocks plugin `id` draws (#2641), while it is enabled code; [] otherwise. */
export function codePluginBlocks(id: string): readonly PluginBlock[] {
  if (!codePluginIdentity(id) || e2ePlugins.has(id)) return [];
  const core = corePlugin(id);
  const manifest = core ? core.manifest : loadedPluginScan().plugins.find((p) => p.manifest.id === id)?.manifest;
  return manifest?.code?.blocks ?? [];
}

/**
 * Every live block the enabled plugins draw (#2641), as an export resolves a
 * fence or directive name against: the first plugin to claim a name keeps it,
 * built-in plugins first, in Settings' order.
 */
export function activePluginBlockSyntax(): PluginBlockSyntax[] {
  const ids = [...corePlugins().map((p) => p.manifest.id), ...loadedPluginScan().plugins.map((p) => p.manifest.id)];
  const out: PluginBlockSyntax[] = [];
  const taken = new Set<string>();
  for (const pluginId of ids) {
    for (const b of codePluginBlocks(pluginId)) {
      const key = b.fence !== undefined ? `fence:${b.fence}` : `directive:${b.directive}`;
      if (taken.has(key)) continue;
      taken.add(key);
      out.push({ pluginId, blockId: b.id, title: b.title, ...(b.fence !== undefined ? { fence: b.fence } : { directive: b.directive! }) });
    }
  }
  return out;
}

/** The logic module plugin `id`'s worker host runs (#2830), while it is enabled code; null when it has none. */
export function codePluginWorker(id: string): string | null {
  if (!codePluginIdentity(id)) return null;
  const e2e = e2eWorkers.get(id);
  if (e2e) return e2e;
  const core = corePlugin(id);
  const manifest = core ? core.manifest : loadedPluginScan().plugins.find((p) => p.manifest.id === id)?.manifest;
  return manifest?.code?.worker ?? null;
}

// The e2e harness's fixture plugins with logic (`e2e-hooks.ts`, MINERVA_E2E only).
const e2eWorkers = new Map<string, string>();

/** Treat `entry` as plugin `id`'s logic module — e2e only (`e2e-hooks.ts`). */
export function _registerCodePluginWorkerForE2E(id: string, entry: string): void {
  e2eWorkers.set(id, entry);
}

/** The commands plugin `id` adds (#2643), while it is enabled code; [] otherwise. */
export function codePluginCommands(id: string): readonly PluginCommand[] {
  if (!codePluginIdentity(id) || e2ePlugins.has(id)) return [];
  const core = corePlugin(id);
  const manifest = core ? core.manifest : loadedPluginScan().plugins.find((p) => p.manifest.id === id)?.manifest;
  return manifest?.code?.commands ?? [];
}

/** The ingestors plugin `id` adds (#2647), while it is enabled code; [] otherwise. */
export function codePluginIngestors(id: string): readonly PluginIngestor[] {
  if (!codePluginIdentity(id) || e2ePlugins.has(id)) return [];
  const core = corePlugin(id);
  const manifest = core ? core.manifest : loadedPluginScan().plugins.find((p) => p.manifest.id === id)?.manifest;
  return manifest?.code?.ingestors ?? [];
}

/**
 * Every ingestor the enabled plugins add (#2647), each with the extensions it
 * gets: the first plugin to claim an extension keeps it, built-in plugins
 * first, in Settings' order. One whose every extension went to another is left out.
 */
export function activePluginIngestors(): { pluginId: string; ingestor: PluginIngestor }[] {
  const ids = [...corePlugins().map((p) => p.manifest.id), ...loadedPluginScan().plugins.map((p) => p.manifest.id)];
  const out: { pluginId: string; ingestor: PluginIngestor }[] = [];
  const taken = new Set<string>();
  for (const pluginId of ids) {
    for (const ingestor of codePluginIngestors(pluginId)) {
      const extensions = ingestor.accepts.extensions.filter((e) => !taken.has(e));
      if (extensions.length === 0) continue;
      for (const e of extensions) taken.add(e);
      out.push({ pluginId, ingestor: { ...ingestor, accepts: { extensions } } });
    }
  }
  return out;
}
