import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { loadConfigFileSync, loadConfigFileStrictSync, requireArray } from './config/config-store';
import { logger } from '../shared/logger';
import { writeJsonFileAtomicSync } from './config/json-file';

const MAX_RECENT = 10;

/**
 * Resolved per call, not at module load. `app.getPath` is unavailable until
 * Electron is ready, so a module-level constant made merely IMPORTING this file
 * a side effect — which broke every test suite that reaches it transitively
 * (notebase/fs.ts → read-note.ts → …) with a bare `electron` mock.
 */
function recentsFilePath(): string {
  return path.join(app.getPath('userData'), 'recent-projects.json');
}

/**
 * Memoized recents (#2221).
 *
 * `getRecentProjects` is one `readFileSync` — trivial on its own, which is
 * why it was fine to call it from `menu.ts`'s File ▸ Open Recent builder.
 * What made it not fine is where that builder runs: `rebuildMenu()` fires on
 * window focus and on every `hasSelection` flip in the focused note, i.e. on a
 * gesture the user performs continuously while editing. A blocking read on the
 * main process's only thread per text selection is a cost with no matching
 * benefit — this list changes when a project is opened or the list is cleared,
 * both of which run through this module.
 *
 * Invalidation has the same two cases as the saved-queries cache: writes from
 * this app (the two functions below update the cache directly, since they
 * already know the new value) and writes from outside it (only reachable by
 * leaving the app, so the focus handler in `window-manager.ts` refreshes —
 * see `menu-input-caches.ts`).
 */
let cache: string[] | null = null;

/** Drop the memoized recents list. See `menu-input-caches.ts` for when. */
export function invalidateRecentProjectsCache(): void {
  cache = null;
}

/** Throws on a file that isn't an array, so the strict read refuses it; the
 *  lenient read reports it and shows no recents. A non-string entry is
 *  dropped on its own rather than costing the whole list. */
function decode(raw: unknown): string[] {
  return requireArray(raw, 'recent-projects.json').filter((p): p is string => typeof p === 'string');
}

export function getRecentProjects(): string[] {
  cache ??= loadConfigFileSync<string[]>(recentsFilePath, decode, []);
  // A copy per call: `defaultThoughtbaseDir` and the menu builder both iterate
  // the result, and `addRecentProject` below mutates the array it gets back.
  return [...cache];
}

/**
 * Record `projectPath` as most recently opened.
 *
 * Reads the file STRICTLY and fresh from disk, not from the memo (#2416). The
 * lenient memo reads a corrupt file as `[]`, and building the write on that
 * replaced the whole list with one entry. Reading disk also keeps a memo that
 * predates an external edit from writing that edit away.
 *
 * An unreadable file is SET ASIDE, not refused and not overwritten. This is the
 * one store in #2416 that does not refuse the write, and the reasons are
 * specific to it:
 *
 *  - Refusing would leave Open Recent dead with no way out in the app. An
 *    unreadable file reads as an empty list, and File ▸ Open Recent only offers
 *    "Clear Recent Thoughtbases" when the list is non-empty, so the one blind
 *    overwrite that could heal it is not on screen. The only signal would be a
 *    log line. It cannot throw either: this runs inside `openProjectInWindow`,
 *    and menu bookkeeping must never stop a thoughtbase from opening.
 *  - Overwriting in place would destroy content Minerva did not write. Since
 *    #2369 its own writes are atomic, so an unreadable file came from outside,
 *    most likely a hand edit with a typo, and replacing it on the next project
 *    open would erase that edit without a word.
 *
 * So the unreadable bytes are renamed to `recent-projects.json.unreadable`
 * (kept whole, for the person to recover from) and the list starts over with
 * this project. What is lost from the menu is at most ten paths, and each comes
 * back the next time it is opened.
 */
export function addRecentProject(projectPath: string): void {
  const file = recentsFilePath();
  let recent: string[];
  try {
    recent = loadConfigFileStrictSync<string[]>(file, decode, []);
  } catch (err) {
    // The strict read has already reported it. If the file cannot be moved
    // aside either, leave it and skip the update rather than overwrite it.
    try {
      fs.renameSync(file, `${file}.unreadable`);
    } catch (renameErr) {
      logger('config').warn(`not recording ${projectPath} in recent projects: ${file} is unreadable and could not be set aside`, err, renameErr);
      return;
    }
    logger('config').warn(`set unreadable ${file} aside as ${file}.unreadable; starting a new recent-projects list`);
    recent = [];
  }
  recent = recent.filter((p) => p !== projectPath);
  recent.unshift(projectPath);
  if (recent.length > MAX_RECENT) recent.length = MAX_RECENT;
  writeJsonFileAtomicSync(file, recent, { indent: 0 });
  cache = [...recent];
}

/**
 * Where a thoughtbase folder picker should start (#1560).
 *
 * People keep their thoughtbases together — a `~/Minerva`, `~/thoughtbases`, or
 * `~/notes` folder — so the PARENT of the last one they opened is a far better
 * guess than the OS default, which lands on Downloads or wherever some
 * unrelated save panel was last. No new setting: the recents list already
 * records every thoughtbase opened or created, so the answer is derivable, and
 * it retrains itself the moment the user starts keeping them somewhere else.
 *
 * Walks the list rather than taking the head blindly: a thoughtbase that's been
 * deleted or moved shouldn't cost the hint. Falls back to Documents — a
 * conventional home for a new folder, and specifically not Downloads.
 */
export function defaultThoughtbaseDir(): string {
  for (const projectPath of getRecentProjects()) {
    const parent = path.dirname(projectPath);
    // `path.dirname('/')` is '/' — a root with no parent tells us nothing.
    if (parent === projectPath) continue;
    try {
      if (fs.statSync(parent).isDirectory()) return parent;
    } catch { /* gone since it was last opened — try the next one */ }
  }
  try {
    return app.getPath('documents');
  } catch {
    return app.getPath('home');
  }
}

/** Replace the list with `[]` without reading it: the user asked for it gone. */
export function clearRecentProjects(): void {
  writeJsonFileAtomicSync(recentsFilePath(), [], { indent: 0 });
  cache = [];
}
