/**
 * `electron` stub for the headless CLI build (#1437).
 *
 * The read core imports `electron` transitively (notebase/fs, notebase/watcher,
 * llm/settings) but never calls it on the CLI's code path. In a dev checkout the
 * CLI externalizes `electron`, so `require('electron')` resolves to the npm
 * `electron` package whose module is the binary-path *string* — meaning every
 * `import { app, dialog, … } from 'electron'` is already `undefined` there, and
 * nothing on the CLI path touches them. The packaged app ships no npm `electron`
 * package, so that runtime require can't resolve. Aliasing `electron` to this
 * stub (see vite.cli.config.ts) bundles the same all-`undefined` shape in,
 * removing the require while preserving the exact dev behavior.
 *
 * These are the value names imported from `electron` anywhere in src/main; type
 * imports are erased at build time and need no export.
 */
export const app = undefined;
export const BrowserWindow = undefined;
export const Menu = undefined;
export const shell = undefined;
export const dialog = undefined;
export const session = undefined;
export const ipcMain = undefined;
export const safeStorage = undefined;
export const autoUpdater = undefined;
export const Notification = undefined;
export default {};
