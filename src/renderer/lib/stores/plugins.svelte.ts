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
import type { PluginList, PluginRecommendation, PluginSettingsPatch, PluginSettingsView } from '../../../shared/plugins/format';
import { applyMenuConfig } from '../../../shared/skills/menu-config';
import { registerSkillInfos } from '../tools/tool-registry';
import { objectTypesStore } from './object-types.svelte';
import { pluginThemesStore } from './plugin-themes.svelte';
import { logger } from '../../../shared/logger';

const EMPTY: PluginList = { core: [], installed: [], errors: [], folder: '' };

let list = $state<PluginList>(EMPTY);
let error = $state<string | null>(null);
let busy = $state(false);

// The open thoughtbase's recommendations (#2635), with the root they're for.
let recommendations = $state<PluginRecommendation[]>([]);
let recommendationsRoot = $state<string | null>(null);
// "Not now", for this run of the app: root → ids hidden.
let hiddenForNow = $state<Record<string, string[]>>({});
let dismissedVersion = $state(0);

/** "Don't show again" is per thoughtbase and per machine, never in the shared config. */
const dismissKey = (root: string) => `plugin-recommendations-dismissed:${root}`;

function dismissedIds(root: string): Set<string> {
  void dismissedVersion;
  try {
    const raw = localStorage.getItem(dismissKey(root));
    const ids: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function hideRecommendations(ids: string[]): void {
  const root = recommendationsRoot;
  if (root === null) return;
  hiddenForNow = { ...hiddenForNow, [root]: [...(hiddenForNow[root] ?? []), ...ids] };
}

async function loadRecommendations(root: string): Promise<void> {
  try {
    const recs = await api.plugins.recommendations();
    recommendations = recs;
    recommendationsRoot = root;
  } catch (e) {
    logger('plugins').warn('reading the thoughtbase\'s recommended plugins failed:', e);
  }
}

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
  await pluginThemesStore.refresh();
}

async function refresh(): Promise<void> {
  list = await api.plugins.list();
}

// A change made anywhere — this window, another one, or outside the app.
// Optional chaining, as the object-types store does: component tests import
// this transitively with only the `api` surface they need mocked.
api?.plugins?.onChanged?.(() => {
  void refresh().catch((e: unknown) => logger('plugins').warn('refreshing the plugin list failed:', e));
  if (recommendationsRoot !== null) void loadRecommendations(recommendationsRoot);
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
    approveCode: (id: string) => run(async () => { list = await api.plugins.approveCode(id); }),
    remove: (id: string) => run(async () => { list = await api.plugins.remove(id); }),
    /** Pick a folder and install it. Resolves with what was installed, or null. */
    installFolder: () => install(() => api.plugins.installFolder()),
    /** Pick a `.zip` and install it. Resolves with what was installed, or null. */
    installZip: () => install(() => api.plugins.installZip()),
    /** Fetch from a git URL and install it. Resolves with what was installed, or null. */
    installGit: (spec: string) => install(() => api.plugins.installGit(spec)),
    reveal: (id?: string) => run(() => api.plugins.reveal(id)),
    /** Save a plugin's settings (#2636). Rejects with every problem, so the form can show them beside it. */
    saveSettings: (id: string, patch: PluginSettingsPatch): Promise<PluginSettingsView> => api.plugins.setSettings(id, patch),

    /** Every recommendation not in use here, dismissed or not (the type hint reads these). */
    get recommendations() { return recommendations; },
    /** The ones the notice should still show: not hidden for now, not dismissed for good. */
    get pendingRecommendations(): PluginRecommendation[] {
      const root = recommendationsRoot;
      if (root === null) return [];
      const gone = dismissedIds(root);
      const hidden = new Set(hiddenForNow[root] ?? []);
      return recommendations.filter((r) => !gone.has(r.id) && !hidden.has(r.id));
    },
    /** Read what the open thoughtbase recommends. Installs nothing. */
    loadRecommendations,
    /** Hide the notice's current entries until the thoughtbase is next opened. */
    hideRecommendations,
    /** Never show these again for this thoughtbase, on this machine. A plugin it recommends later still shows. */
    dismissRecommendations(ids: string[]) {
      const root = recommendationsRoot;
      if (root === null) return;
      const next = [...new Set([...dismissedIds(root), ...ids])];
      try { localStorage.setItem(dismissKey(root), JSON.stringify(next)); } catch { /* storage unavailable: hidden for now instead */ }
      dismissedVersion++;
      hideRecommendations(ids);
    },
    /**
     * The recommendation behind a `type:` no catalog defines: the one that
     * names the type, else every recommendation that names no types (any of
     * them might provide it).
     */
    recommendationsForType(typeId: string): { exact: PluginRecommendation | null; possible: PluginRecommendation[] } {
      const id = typeId.trim().toLowerCase();
      const exact = recommendations.find((r) => r.types.includes(id)) ?? null;
      return { exact, possible: exact ? [] : recommendations.filter((r) => r.types.length === 0) };
    },
  };
}
