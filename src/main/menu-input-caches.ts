/**
 * The disk reads behind the native menu, and the one moment they must be
 * re-done (#2221).
 *
 * `rebuildMenu()` reads three things off disk to build its template:
 *
 *   - the saved-query files (`listSavedQueries` — two `readdirSync`s plus a
 *     `readFileSync` per `.rq`/`.sql`, so the cost scales with how many
 *     queries the user has saved),
 *   - `recent-projects.json` (one `readFileSync`),
 *   - each open window's `.minerva/config.json`, for the macOS Window menu's
 *     thoughtbase labels (`resolveDisplayName`, one `readFileSync` per window).
 *
 * Measured on a thoughtbase with six project and six global queries: 14
 * `readFileSync` + 2 `readdirSync` per rebuild, ~0.5ms of *blocking* main-
 * process time. That would be unremarkable if rebuilds were rare. They are
 * not: `window-manager.ts` rebuilds on every window `focus`, and `menu.ts`'s
 * `setMenuEditorState` rebuilds whenever the focused note's `hasSelection`
 * flag flips — which is to say, every time the user selects or deselects text.
 * The renderer already dedupes so that typing doesn't send a report per
 * keystroke, but select/deselect is itself a continuous editing gesture, and
 * every one of them was landing a burst of synchronous file reads on the
 * thread that also has to paint.
 *
 * Each of the three readers now memoizes, and each invalidates its own cache
 * when *this app* writes the underlying file. This module handles the other
 * half: a write from OUTSIDE the app — the user editing a `.rq` in their text
 * editor, a sync client dropping one in, a second Minerva install. There is no
 * watcher on these paths, and adding three would be a lot of machinery for
 * files that change a few times a month.
 *
 * It also isn't necessary, because of a property of how external edits
 * actually happen: making one requires the user to be in some *other*
 * application, which means Minerva lost focus and has to regain it before the
 * change can matter. So invalidating on `focus` catches every external edit,
 * and catches it at precisely the moment `rebuildMenu()` already runs today —
 * the menu ends up showing exactly what it showed before this change, at
 * exactly the same time, having done the reads once per focus instead of once
 * per text selection.
 *
 * Called from `window-manager.ts`'s `win.on('focus')`, immediately before the
 * rebuild it already triggers.
 */
import { invalidateSavedQueriesCache } from './saved-queries';
import { invalidateRecentProjectsCache } from './recent-projects';
import { invalidateDisplayNameCache } from './project-config';

/**
 * Drop every memoized disk read that feeds the native menu, so the next
 * `rebuildMenu()` sees whatever is on disk now.
 *
 * Add to this list when you add a disk read to a menu builder — the whole
 * point is that there is one function to find, rather than three module-local
 * caches each hoping the next person notices them.
 */
export function invalidateMenuInputCaches(): void {
  invalidateSavedQueriesCache();
  invalidateRecentProjectsCache();
  invalidateDisplayNameCache();
}
