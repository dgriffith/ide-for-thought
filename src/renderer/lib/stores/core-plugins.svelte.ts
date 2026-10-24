/**
 * Which built-in plugins are on (#2828) — what a layout a plugin draws is
 * gated on. Read from `plugins.list()`'s `core` entries, and again whenever
 * the plugins change.
 *
 * Until the first answer lands every plugin counts as on, as
 * `computeLanguagesStore` does: a view that tries to draw a moment early
 * fails safe (the frame is refused a session), while a "turned off" line
 * flashing up for someone who has it on would be wrong.
 */
import { api } from '../ipc/client';
import { logger } from '../../../shared/logger';
import type { PluginView, PluginViewPlace } from '../../../shared/plugins/format';

/** A global view an enabled built-in plugin draws (#2640). */
export interface ActivePluginView {
  pluginId: string;
  pluginName: string;
  view: PluginView;
}

let core = $state<ReadonlyMap<string, { name: string; enabled: boolean; views: readonly PluginView[] }> | null>(null);
let started = false;

async function refresh(): Promise<void> {
  // A window with no plugins API at all is a partial test double: no answer,
  // so every plugin counts as on. A real API that fails is reported below.
  if (!api.plugins) return;
  try {
    const list = await api.plugins.list();
    core = new Map(list.core.map((p) => [p.id, { name: p.name, enabled: p.enabled, views: p.views ?? [] }]));
  } catch (e) {
    logger('plugins').warn('could not read which built-in plugins are on:', e);
  }
}

function start(): void {
  if (started) return;
  started = true;
  // Not knowing which plugins are on must never break the view asking: the
  // answer stays "on" (see the header), and the failure is logged.
  try {
    void refresh();
    api.plugins?.onChanged(() => { void refresh(); });
  } catch (e) {
    logger('plugins').warn('could not follow which built-in plugins are on:', e);
  }
}

export const corePluginsStore = {
  /** Whether built-in plugin `id` is on. Reactive. */
  isOn(id: string): boolean {
    start();
    return core === null ? true : core.get(id)?.enabled ?? false;
  },
  /**
   * The global views the plugins that are on draw in `place` (#2640),
   * in the order Settings lists the plugins. Reactive. Unlike `isOn`, none
   * until the list has loaded: a panel can't be offered before it's known.
   */
  views(place: PluginViewPlace): ActivePluginView[] {
    return corePluginsStore.allViews().filter((v) => v.view.place === place);
  },
  /**
   * One global view, wherever it shows (#2640): what a plugin-view tab is
   * drawn from. `undefined` until the list has loaded; null when the plugin
   * is off or no longer has that view. Reactive.
   */
  view(pluginId: string, viewId: string): ActivePluginView | null | undefined {
    start();
    if (core === null) return undefined;
    const p = core.get(pluginId);
    const view = p?.enabled ? p.views.find((v) => v.id === viewId) : undefined;
    return view ? { pluginId, pluginName: p!.name, view } : null;
  },
  /** Every global view of the plugins that are on, wherever it shows (#2640): the palette's list. */
  allViews(): ActivePluginView[] {
    start();
    if (core === null) return [];
    return [...core].flatMap(([pluginId, p]) => (p.enabled ? p.views.map((view) => ({ pluginId, pluginName: p.name, view })) : []));
  },
  /** Its name, for "turn on X" — the id until the list has loaded. */
  name(id: string): string {
    start();
    return core?.get(id)?.name ?? id;
  },
};
