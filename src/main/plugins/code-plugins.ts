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
import { corePlugin } from './core';
import { loadedPluginScan } from './registry';
import type { PluginIdentity } from './broker';
import type { PluginView } from '../../shared/plugins/format';

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
