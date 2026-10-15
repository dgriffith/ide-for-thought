/**
 * Watch `~/.minerva/plugins/` (#2634), so a plugin added, edited or removed
 * outside the app — by its author, or by an agent writing one — applies
 * without a restart. Events are debounced; the hidden staging folders an
 * install uses are ignored. Creates the folder if it isn't there yet (an
 * empty folder is what "no plugins" looks like, and what Open folder opens).
 *
 * `fs.watch` is recursive on macOS and Windows, and on Linux from Node 20.
 * A folder that can't be watched is logged; the app still works, a change
 * just needs a restart to apply.
 */
import fs from 'node:fs';
import { logger } from '../../shared/logger';

export const PLUGINS_WATCH_DEBOUNCE_MS = 400;

/**
 * macOS reports the watched folder itself once, ~10ms after watching starts
 * (FSEvents replaying its recent creation) — an event about nothing that
 * changed, which would re-apply the plugins at every launch. Events in this
 * window are dropped.
 */
export const PLUGINS_WATCH_WARMUP_MS = 250;

export function watchPluginsDir(dir: string, onChange: () => void, debounceMs = PLUGINS_WATCH_DEBOUNCE_MS): () => void {
  let timer: NodeJS.Timeout | null = null;
  let watcher: fs.FSWatcher;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const startedAt = Date.now();
    watcher = fs.watch(dir, { recursive: true }, (_event, filename) => {
      if (Date.now() - startedAt < PLUGINS_WATCH_WARMUP_MS) return;
      const name = filename?.toString() ?? '';
      // An install's staging folder, or another hidden entry: not a plugin.
      if (name.startsWith('.')) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; onChange(); }, debounceMs);
    });
    watcher.on('error', (e) => logger('plugins').warn('the plugins folder watcher stopped:', e));
  } catch (e) {
    logger('plugins').warn(`can't watch ${dir}; plugin changes there apply on restart:`, e);
    return () => undefined;
  }
  return () => {
    if (timer) clearTimeout(timer);
    watcher.close();
  };
}
