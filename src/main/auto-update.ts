/**
 * In-app auto-update (#662).
 *
 * The repo is public and the app is signed (#959), so we use the hosted
 * Squirrel.Mac feed at update.electronjs.org via `update-electron-app`
 * rather than a self-hosted server or electron-updater (which would mismatch
 * a forge project). It reads the target repo from package.json's `repository`
 * field, polls the feed, downloads a newer *published* release's `.zip` via
 * Squirrel.Mac, and prompts the user to restart.
 *
 * `update.electronjs.org` only serves **published** (non-draft) releases, so
 * auto-update begins the moment a drafted release is published (see the
 * release runbook, #960). End-to-end apply is verified across two real
 * releases in #961.
 */

import { app } from 'electron';
import { updateElectronApp } from 'update-electron-app';

/**
 * Wire up the hosted updater. Inert unless the app is packaged: an
 * `electron-forge start` dev run has no code signature and nothing to update
 * to, so we skip setup entirely — no polling, no dialogs, no errors. Any
 * config/runtime error (e.g. a missing `repository` field) is swallowed with
 * a warning: a broken updater must never crash the user's app on launch.
 */
export function initAutoUpdate(): void {
  if (!app.isPackaged) return;
  try {
    updateElectronApp({
      // Default updateSource is update.electronjs.org; the repo is inferred
      // from package.json `repository`. Hourly is gentle but still same-day.
      updateInterval: '1 hour',
      logger: console,
    });
  } catch (err) {
    console.warn('[auto-update] setup failed; continuing without updates:', err);
  }
}
