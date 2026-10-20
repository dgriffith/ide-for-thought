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

let core = $state<ReadonlyMap<string, { name: string; enabled: boolean }> | null>(null);
let started = false;

async function refresh(): Promise<void> {
  try {
    const list = await api.plugins.list();
    core = new Map(list.core.map((p) => [p.id, { name: p.name, enabled: p.enabled }]));
  } catch (e) {
    logger('plugins').warn('could not read which built-in plugins are on:', e);
  }
}

function start(): void {
  if (started) return;
  started = true;
  void refresh();
  api.plugins.onChanged(() => { void refresh(); });
}

export const corePluginsStore = {
  /** Whether built-in plugin `id` is on. Reactive. */
  isOn(id: string): boolean {
    start();
    return core === null ? true : core.get(id)?.enabled ?? false;
  },
  /** Its name, for "turn on X" — the id until the list has loaded. */
  name(id: string): string {
    start();
    return core?.get(id)?.name ?? id;
  },
};
