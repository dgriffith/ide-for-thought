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
import { adoptCorePluginState, corePlugins, hasCorePluginRecord, readCorePluginStates } from './plugins/core';
import { activePluginsDir } from './plugins/registry';
import { registerPythonCompute } from './ipc/register-compute';
import { pythonSettingsSaved } from './compute/python-settings';
import { anyComputeConsentRecorded } from './compute/consent';
import { markCorePluginActive } from './core-plugins-active';

/** Wire a core plugin up; the result takes it down again. */
export type CorePluginActivation = () => () => void;

/** What each core plugin does when it's on, by id. */
const CORE_PLUGIN_ACTIVATIONS: Readonly<Record<string, CorePluginActivation>> = {
  python: registerPythonCompute,
};

/**
 * A core plugin that's off by default but was part of Minerva before it
 * became a plugin: on a machine that shows it was used, and that has never
 * switched it, it's recorded on, once, so an upgrade breaks nothing (#2822).
 */
const KEEP_ON_IF_USED: Readonly<Record<string, () => boolean>> = {
  python: () => pythonSettingsSaved() || anyComputeConsentRecorded(),
};

let activations: Readonly<Record<string, CorePluginActivation>> = CORE_PLUGIN_ACTIVATIONS;
let keepOnIfUsed: Readonly<Record<string, () => boolean>> = KEEP_ON_IF_USED;
const active = new Map<string, () => void>();

function activate(id: string): void {
  const run = activations[id];
  if (!run || active.has(id)) return;
  try {
    active.set(id, run());
    markCorePluginActive(id, true);
  } catch (e) {
    // A core plugin that can't start costs that plugin, never the app.
    logger('plugins').error(`core plugin ${id} failed to start:`, e);
  }
}

function deactivate(id: string): void {
  const stop = active.get(id);
  if (!stop) return;
  active.delete(id);
  markCorePluginActive(id, false);
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

/**
 * At startup, before any window: settle the one-time defaults of plugins
 * that used to be part of Minerva, then wire up the core plugins that are on.
 */
export function startCorePlugins(): void {
  const dir = activePluginsDir();
  for (const [id, used] of Object.entries(keepOnIfUsed)) {
    try {
      if (!hasCorePluginRecord(dir, id) && used()) adoptCorePluginState(dir, id, true);
    } catch (e) {
      // An unreadable plugins.json keeps its default; it's reported where it's read.
      logger('plugins').warn(`couldn't settle core plugin ${id}'s first state:`, e);
    }
  }
  syncCorePlugins();
}

export { activeCorePlugins, isCorePluginActive } from './core-plugins-active';

/**
 * Replace the activations; `null` puts the real ones back, after taking down
 * whatever is wired up. Tests only.
 */
export function _setCoreActivationsForTests(
  next: Readonly<Record<string, CorePluginActivation>> | null,
  keepOn: Readonly<Record<string, () => boolean>> | null = {},
): void {
  for (const id of [...active.keys()]) deactivate(id);
  activations = next ?? CORE_PLUGIN_ACTIVATIONS;
  keepOnIfUsed = next === null ? KEEP_ON_IF_USED : (keepOn ?? KEEP_ON_IF_USED);
}
