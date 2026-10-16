/**
 * Installed plugins (#2634) — Settings → Plugins' state, and the renderer's
 * half of applying a plugin change.
 *
 * Main applies every change to itself before answering (and before sending
 * `plugins:changed`, for a change made outside the app). This store's part is
 * the renderer's registries: on `plugins:changed` it refreshes the list,
 * re-registers the skills (palette, slash commands) and refreshes the object
 * types — so a plugin's contributions appear and disappear in every open
 * window without a restart.
 */
import { api } from '../ipc/client';
import type { PluginList } from '../../../shared/plugins/format';
import { applyMenuConfig } from '../../../shared/skills/menu-config';
import { registerSkillInfos } from '../tools/tool-registry';
import { objectTypesStore } from './object-types.svelte';
import { logger } from '../../../shared/logger';

const EMPTY: PluginList = { installed: [], errors: [], folder: '' };

let list = $state<PluginList>(EMPTY);
let error = $state<string | null>(null);
let busy = $state(false);

async function run(fn: () => Promise<void>): Promise<void> {
  error = null;
  busy = true;
  try {
    await fn();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  } finally {
    busy = false;
  }
}

/** The renderer's registries, brought in line with main's. */
async function refreshContributions(): Promise<void> {
  try {
    const cat = await api.skills.list();
    registerSkillInfos(applyMenuConfig(cat.skills, cat.config));
  } catch (e) {
    logger('plugins').warn('re-registering skills after a plugin change failed:', e);
  }
  await objectTypesStore.refresh().catch((e: unknown) => logger('plugins').warn('refreshing object types after a plugin change failed:', e));
}

async function refresh(): Promise<void> {
  list = await api.plugins.list();
}

// A change made anywhere — this window, another one, or outside the app.
// Optional chaining, as the object-types store does: component tests import
// this transitively with only the `api` surface they need mocked.
api?.plugins?.onChanged?.(() => {
  void refresh().catch((e: unknown) => logger('plugins').warn('refreshing the plugin list failed:', e));
  void refreshContributions();
});

async function install(pick: () => Promise<{ id: string; name: string } | null>): Promise<{ id: string; name: string } | null> {
  let installed: { id: string; name: string } | null = null;
  await run(async () => {
    installed = await pick();
    list = await api.plugins.list();
  });
  return installed;
}

export function getPluginsStore() {
  return {
    get list() { return list; },
    get error() { return error; },
    get busy() { return busy; },
    refresh: () => run(refresh),
    setEnabled: (id: string, enabled: boolean) => run(async () => { list = await api.plugins.setEnabled(id, enabled); }),
    remove: (id: string) => run(async () => { list = await api.plugins.remove(id); }),
    /** Pick a folder and install it. Resolves with what was installed, or null. */
    installFolder: () => install(() => api.plugins.installFolder()),
    /** Pick a `.zip` and install it. Resolves with what was installed, or null. */
    installZip: () => install(() => api.plugins.installZip()),
    /** Fetch from a git URL and install it. Resolves with what was installed, or null. */
    installGit: (spec: string) => install(() => api.plugins.installGit(spec)),
    reveal: (id?: string) => run(() => api.plugins.reveal(id)),
  };
}
