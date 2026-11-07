/**
 * Auto-update wiring (#662) + update UX (#963).
 *
 * We can't exercise a real Squirrel.Mac apply without two published releases
 * (#961), but we can pin the behaviour that matters: inert in dev, wired when
 * packaged, a manual check that reports its result, and a background download
 * that surfaces quietly (notification) rather than hijacking with a modal.
 * `electron` and `update-electron-app` are mocked; the fake `autoUpdater` is a
 * tiny emitter we drive to simulate feed events.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => {
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
  const autoUpdater = {
    on: (evt: string, cb: (...args: unknown[]) => void) => {
      (listeners[evt] ??= []).push(cb);
    },
    emit: (evt: string, ...args: unknown[]) => {
      (listeners[evt] ?? []).forEach((cb) => cb(...args));
    },
    checkForUpdates: vi.fn(),
    quitAndInstall: vi.fn(),
  };
  return {
    isPackaged: false,
    updateElectronApp: vi.fn(),
    autoUpdater,
    showMessageBox: vi.fn(() => Promise.resolve({ response: 0 })),
    showMessageBoxSync: vi.fn(() => 1), // default: 'Later'
    notificationShow: vi.fn(),
    notificationSupported: true,
    openExternal: vi.fn(),
  };
});

vi.mock('electron', () => {
  class Notification {
    static isSupported() { return h.notificationSupported; }
    on() { return this; }
    show() { h.notificationShow(); }
  }
  return {
    app: {
      get isPackaged() { return h.isPackaged; },
      getVersion: () => '1.2.3',
    },
    autoUpdater: h.autoUpdater,
    dialog: {
      showMessageBox: h.showMessageBox,
      showMessageBoxSync: h.showMessageBoxSync,
    },
    Notification,
    shell: { openExternal: h.openExternal },
  };
});

vi.mock('update-electron-app', () => ({ updateElectronApp: h.updateElectronApp }));

import {
  initAutoUpdate,
  checkForUpdatesNow,
  getUpdateState,
  isUpdateDownloaded,
  quitAndInstallUpdate,
  setUpdateStateListener,
  _resetUpdateStateForTest,
  RELEASES_URL,
  updatesInApp,
} from '../../src/main/auto-update';

/** Run `fn` with `process.platform` forced. */
async function onPlatform(value: NodeJS.Platform, fn: () => unknown): Promise<void> {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { ...original, value });
  try { await fn(); } finally { Object.defineProperty(process, 'platform', original); }
}

// The in-app updater runs on macOS and Windows only (#2184): pin macOS so
// these tests mean the same on a Linux or Windows host; the per-platform
// block at the end sets its own.
const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
beforeEach(() => {
  Object.defineProperty(process, 'platform', { ...realPlatform, value: 'darwin' });
  h.isPackaged = false;
  h.updateElectronApp.mockReset();
  h.autoUpdater.checkForUpdates.mockReset();
  h.autoUpdater.quitAndInstall.mockReset();
  h.showMessageBox.mockClear();
  h.showMessageBoxSync.mockReset().mockReturnValue(1);
  h.notificationShow.mockReset();
  h.notificationSupported = true;
  h.openExternal.mockReset();
  setUpdateStateListener(() => {});
  _resetUpdateStateForTest();
});
afterEach(() => { Object.defineProperty(process, 'platform', realPlatform); });

describe('initAutoUpdate', () => {
  it('does nothing when the app is not packaged (dev)', () => {
    h.isPackaged = false;
    initAutoUpdate();
    expect(h.updateElectronApp).not.toHaveBeenCalled();
  });

  it('wires the hosted updater with notifyUser:false when packaged', () => {
    h.isPackaged = true;
    initAutoUpdate();
    expect(h.updateElectronApp).toHaveBeenCalledTimes(1);
    expect(h.updateElectronApp.mock.calls[0][0]).toMatchObject({
      updateInterval: expect.any(String),
      notifyUser: false,
    });
  });

  it('swallows a setup failure so a broken updater cannot crash launch', () => {
    h.isPackaged = true;
    h.updateElectronApp.mockImplementation(() => { throw new Error('bad repository'); });
    expect(() => initAutoUpdate()).not.toThrow();
  });
});

describe('feed events', () => {
  beforeEach(() => {
    h.isPackaged = true;
    initAutoUpdate(); // attach listeners (idempotent)
    _resetUpdateStateForTest();
  });

  it('tracks state and notifies the listener on each transition', () => {
    const seen: string[] = [];
    setUpdateStateListener(() => seen.push(getUpdateState()));

    h.autoUpdater.emit('checking-for-update');
    expect(getUpdateState()).toBe('checking');

    h.autoUpdater.emit('update-available');
    expect(getUpdateState()).toBe('downloading');

    expect(seen).toEqual(['checking', 'downloading']);
  });

  it('a background download surfaces via notification, not a modal', () => {
    h.autoUpdater.emit('update-downloaded', {}, 'notes', 'v1.3.0');
    expect(getUpdateState()).toBe('downloaded');
    expect(isUpdateDownloaded()).toBe(true);
    expect(h.notificationShow).toHaveBeenCalledTimes(1);
    expect(h.showMessageBoxSync).not.toHaveBeenCalled(); // no hijacking modal
  });
});

describe('checkForUpdatesNow', () => {
  it('in dev, reports unavailable and never touches the updater', () => {
    h.isPackaged = false;
    checkForUpdatesNow();
    expect(h.showMessageBox).toHaveBeenCalledTimes(1);
    expect(h.autoUpdater.checkForUpdates).not.toHaveBeenCalled();
  });

  it('packaged, triggers a check and reports "up to date" when none is found', () => {
    h.isPackaged = true;
    initAutoUpdate();
    _resetUpdateStateForTest();

    checkForUpdatesNow();
    expect(getUpdateState()).toBe('checking');
    expect(h.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);

    // A user-initiated check DOES report its result (dialog), unlike background.
    h.autoUpdater.emit('update-not-available');
    expect(getUpdateState()).toBe('up-to-date');
    expect(h.showMessageBox).toHaveBeenCalledTimes(1);
  });

  it('offers restart immediately when a build is already staged', () => {
    h.isPackaged = true;
    initAutoUpdate();
    _resetUpdateStateForTest();
    h.autoUpdater.emit('update-downloaded', {}, 'notes', 'v1.3.0'); // now 'downloaded'
    h.showMessageBoxSync.mockReset().mockReturnValue(0); // user clicks 'Restart Now'

    checkForUpdatesNow();
    expect(h.autoUpdater.checkForUpdates).not.toHaveBeenCalled(); // no re-check
    expect(h.showMessageBoxSync).toHaveBeenCalledTimes(1);
    expect(h.autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
  });
});

describe('quitAndInstallUpdate', () => {
  it('installs when the user confirms the restart', () => {
    h.showMessageBoxSync.mockReturnValue(0); // 'Restart Now'
    quitAndInstallUpdate();
    expect(h.autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the user picks Later', () => {
    h.showMessageBoxSync.mockReturnValue(1); // 'Later'
    quitAndInstallUpdate();
    expect(h.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });
});

describe('per platform (#2184)', () => {
  it('macOS and Windows update in the app; Linux by installing the next package', () => {
    expect(updatesInApp('darwin')).toBe(true);
    expect(updatesInApp('win32')).toBe(true);
    expect(updatesInApp('linux')).toBe(false);
  });

  it('on Windows the packaged app starts the same updater as on macOS', async () => {
    h.isPackaged = true;
    await onPlatform('win32', () => initAutoUpdate());
    expect(h.updateElectronApp).toHaveBeenCalledTimes(1);
  });

  it('on Linux nothing polls', async () => {
    h.isPackaged = true;
    await onPlatform('linux', () => initAutoUpdate());
    expect(h.updateElectronApp).not.toHaveBeenCalled();
  });

  it('on Linux, Check for Updates… says how to update and offers the releases page', async () => {
    h.isPackaged = true;
    h.showMessageBox.mockResolvedValueOnce({ response: 0 });
    await onPlatform('linux', async () => {
      checkForUpdatesNow();
      await vi.waitFor(() => expect(h.openExternal).toHaveBeenCalledWith(RELEASES_URL));
    });
    expect(h.autoUpdater.checkForUpdates).not.toHaveBeenCalled();
    expect(h.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({
      message: "You're running Minerva 1.2.3",
      buttons: ['Open Releases Page', 'OK'],
      detail: expect.stringMatching(/\.deb or \.rpm/),
    }));
  });

  it('on Linux, OK opens nothing', async () => {
    h.isPackaged = true;
    h.showMessageBox.mockResolvedValueOnce({ response: 1 });
    await onPlatform('linux', async () => {
      checkForUpdatesNow();
      await vi.waitFor(() => expect(h.showMessageBox).toHaveBeenCalled());
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(h.openExternal).not.toHaveBeenCalled();
  });
});
