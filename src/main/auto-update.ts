/**
 * In-app auto-update (#662) + update UX (#963).
 *
 * The repo is public and the app is signed (#959), so we use the hosted
 * Squirrel.Mac feed at update.electronjs.org via `update-electron-app`
 * rather than a self-hosted server or electron-updater (which would mismatch
 * a forge project). It reads the target repo from package.json's `repository`
 * field, polls the feed, and downloads a newer *published* release's `.zip`.
 *
 * We pass `notifyUser: false` and own the UX ourselves (#963): rather than the
 * library's modal "restart now?" the moment a download finishes — which would
 * hijack the user mid-task — a background-downloaded update surfaces quietly (a
 * native notification + a "Restart to Install Update" menu item). A user-
 * initiated **Check for Updates…** is allowed to be chatty (dialogs), since the
 * user asked and is waiting on the answer.
 *
 * `update.electronjs.org` only serves **published** (non-draft) releases, so
 * auto-update begins the moment a drafted release is published (see the
 * release runbook, #960). End-to-end apply is verified across two real
 * releases in #961.
 */

import { app, autoUpdater, dialog, Notification } from 'electron';
import { updateElectronApp } from 'update-electron-app';
import { logger } from '../shared/logger';

export type UpdateState =
  | 'idle'
  | 'checking'
  | 'downloading' // update-available → Squirrel.Mac downloads automatically
  | 'downloaded'
  | 'up-to-date'
  | 'error';

let state: UpdateState = 'idle';
let downloadedVersion: string | null = null;
// True while a check was kicked off by the user (menu item), so the terminal
// event reports back with a dialog instead of surfacing quietly.
let manualCheck = false;
let wired = false;
let onStateChange: (() => void) | null = null;

/** Register a callback fired whenever the update state changes (e.g. to
 *  rebuild the menu so the "Restart to Install Update" item appears). */
export function setUpdateStateListener(fn: () => void): void {
  onStateChange = fn;
}

export function getUpdateState(): UpdateState {
  return state;
}

export function isUpdateDownloaded(): boolean {
  return state === 'downloaded';
}

function setState(next: UpdateState): void {
  state = next;
  onStateChange?.();
}

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
    wireEvents();
    updateElectronApp({
      // Default updateSource is update.electronjs.org; the repo is inferred
      // from package.json `repository`. Hourly is gentle but still same-day.
      updateInterval: '1 hour',
      notifyUser: false, // we own the update UX (#963)
      logger: console,
    });
  } catch (err) {
    logger('auto-update').warn('setup failed; continuing without updates:', err);
  }
}

/** Attach our listeners to the shared Electron autoUpdater. `update-electron-app`
 *  drives the same singleton, so these coexist with its polling. */
function wireEvents(): void {
  if (wired) return;
  wired = true;

  autoUpdater.on('checking-for-update', () => setState('checking'));

  autoUpdater.on('update-available', () => {
    setState('downloading');
    if (manualCheck) {
      manualCheck = false;
      void infoDialog(
        'Update available',
        'A new version is downloading in the background. You’ll be notified when it’s ready to install.',
      );
    }
  });

  autoUpdater.on('update-not-available', () => {
    setState('up-to-date');
    if (manualCheck) {
      manualCheck = false;
      void infoDialog('You’re up to date', `Minerva ${app.getVersion()} is the latest version.`);
    }
  });

  autoUpdater.on('update-downloaded', (_event, _notes, releaseName?: string) => {
    downloadedVersion = releaseName ?? null;
    const wasManual = manualCheck;
    manualCheck = false;
    setState('downloaded');
    // User is waiting on a manual check → offer the restart now. Otherwise stay
    // out of the way: a native notification + the menu item carry it.
    if (wasManual) promptRestart();
    else notifyReady();
  });

  autoUpdater.on('error', (err) => {
    logger('auto-update').warn('error:', err);
    setState('error');
    if (manualCheck) {
      manualCheck = false;
      void infoDialog(
        'Update check failed',
        'Could not check for updates right now. Please try again later.',
      );
    }
  });
}

/**
 * On-demand check from the "Check for Updates…" menu item. Reports the result
 * to the user (up-to-date / downloading / ready), since they explicitly asked.
 */
export function checkForUpdatesNow(): void {
  if (!app.isPackaged) {
    void infoDialog(
      'Updates unavailable',
      'Automatic updates are only available in packaged, signed builds — not in development.',
    );
    return;
  }
  // Already have a build staged — just offer to install it rather than re-check.
  if (state === 'downloaded') {
    promptRestart();
    return;
  }
  try {
    manualCheck = true;
    setState('checking');
    autoUpdater.checkForUpdates();
  } catch (err) {
    manualCheck = false;
    logger('auto-update').warn('manual check failed:', err);
    void infoDialog('Update check failed', 'Could not check for updates right now.');
  }
}

/** Confirm, then quit + install the downloaded update. Invoked by the menu
 *  item, the notification click, or a manual check that found a staged build. */
export function quitAndInstallUpdate(): void {
  promptRestart();
}

function promptRestart(): void {
  const label = downloadedVersion ? `Minerva ${downloadedVersion}` : 'A new version of Minerva';
  const choice = dialog.showMessageBoxSync({
    type: 'info',
    buttons: ['Restart Now', 'Later'],
    defaultId: 0,
    cancelId: 1,
    title: 'Install update',
    message: `${label} is ready to install.`,
    detail: 'Minerva will restart to finish updating. Your work is saved when the window closes.',
  });
  if (choice === 0) {
    // Triggers app quit → our before-quit flush (main.ts) → Squirrel swaps the
    // bundle and relaunches.
    autoUpdater.quitAndInstall();
  }
}

/** Unobtrusive, dismissable "update ready" surface for a background download. */
function notifyReady(): void {
  if (!Notification.isSupported()) return;
  const body = downloadedVersion
    ? `Minerva ${downloadedVersion} has been downloaded. Restart to install.`
    : 'A new version has been downloaded. Restart to install.';
  const notice = new Notification({ title: 'Update ready', body });
  notice.on('click', () => promptRestart());
  notice.show();
}

function infoDialog(message: string, detail: string): Promise<unknown> {
  return dialog.showMessageBox({ type: 'info', message, detail, buttons: ['OK'] });
}

/** Reset transient state between tests. Leaves the (idempotent) autoUpdater
 *  listeners in place so re-init doesn't double-wire them. */
export function _resetUpdateStateForTest(): void {
  state = 'idle';
  downloadedVersion = null;
  manualCheck = false;
}
