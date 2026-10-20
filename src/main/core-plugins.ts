/**
 * Wiring core plugins up and down (#2820). `plugins/core.ts` says which core
 * plugins exist and whether each is on; this says what each one does when it
 * is, so it lives in the composition root, beside the subsystems it switches.
 *
 * A core plugin's activation registers everything the plugin is (IPC
 * handlers through `handle()`, registry entries, processes) and returns the
 * function that takes it all down again. Off means not wired up: a renderer,
 * compromised or not, finds no handler to call, and nothing in a thoughtbase
 * can name one into existence.
 *
 * `startCorePlugins` runs at startup, synchronously, before any window: the
 * state comes from a sync read of `plugins.json` and activations are sync, so
 * a handler a window may call exists before the window does. After a toggle
 * (or an outside edit of `plugins.json`), `syncCorePlugins` brings each one in
 * line from `plugins-apply.ts`.
 */
import { logger } from '../shared/logger';
import { corePlugins, readCorePluginStates } from './plugins/core';
import { activePluginsDir } from './plugins/registry';

/** Wire a core plugin up; the result takes it down again. */
export type CorePluginActivation = () => () => void;

/** What each core plugin does when it's on, by id. None yet (#2822, #2828). */
const CORE_PLUGIN_ACTIVATIONS: Readonly<Record<string, CorePluginActivation>> = {};

let activations: Readonly<Record<string, CorePluginActivation>> = CORE_PLUGIN_ACTIVATIONS;
const active = new Map<string, () => void>();

function activate(id: string): void {
  const run = activations[id];
  if (!run || active.has(id)) return;
  try {
    active.set(id, run());
  } catch (e) {
    // A core plugin that can't start costs that plugin, never the app.
    logger('plugins').error(`core plugin ${id} failed to start:`, e);
  }
}

function deactivate(id: string): void {
  const stop = active.get(id);
  if (!stop) return;
  active.delete(id);
  try {
    stop();
  } catch (e) {
    logger('plugins').error(`core plugin ${id} failed to stop cleanly:`, e);
  }
}

/** Bring every core plugin in line with `plugins.json`: on → wired up, off → not. */
export function syncCorePlugins(): void {
  const states = readCorePluginStates(activePluginsDir());
  for (const plugin of corePlugins()) {
    const id = plugin.manifest.id;
    if (states.get(id)) activate(id);
    else deactivate(id);
  }
}

/** At startup, before any window: wire up the core plugins that are on. */
export const startCorePlugins = syncCorePlugins;

/** The core plugins wired up right now. */
export function activeCorePlugins(): string[] {
  return [...active.keys()];
}

/**
 * Replace the activations; `null` puts the real ones back, after taking down
 * whatever is wired up. Tests only.
 */
export function _setCoreActivationsForTests(next: Readonly<Record<string, CorePluginActivation>> | null): void {
  for (const id of [...active.keys()]) deactivate(id);
  activations = next ?? CORE_PLUGIN_ACTIVATIONS;
}
