/**
 * Auto-update wiring (#662).
 *
 * The one invariant worth pinning without two real releases: the updater is
 * inert in dev (`!app.isPackaged`) — no polling, no dialogs — and it never
 * crashes launch, even if `update-electron-app` throws during setup. We mock
 * both `electron` and `update-electron-app` and assert the gating.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  isPackaged: false,
  updateElectronApp: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    get isPackaged() { return h.isPackaged; },
  },
}));

vi.mock('update-electron-app', () => ({
  updateElectronApp: h.updateElectronApp,
}));

import { initAutoUpdate } from '../../src/main/auto-update';

beforeEach(() => {
  h.isPackaged = false;
  h.updateElectronApp.mockReset();
});

describe('initAutoUpdate', () => {
  it('does nothing when the app is not packaged (dev)', () => {
    h.isPackaged = false;
    initAutoUpdate();
    expect(h.updateElectronApp).not.toHaveBeenCalled();
  });

  it('wires the hosted updater when the app is packaged', () => {
    h.isPackaged = true;
    initAutoUpdate();
    expect(h.updateElectronApp).toHaveBeenCalledTimes(1);
    // Default source (update.electronjs.org) + an update interval configured.
    const opts = h.updateElectronApp.mock.calls[0][0];
    expect(opts).toMatchObject({ updateInterval: expect.any(String) });
  });

  it('swallows a setup failure so a broken updater cannot crash launch', () => {
    h.isPackaged = true;
    h.updateElectronApp.mockImplementation(() => {
      throw new Error('bad repository field');
    });
    expect(() => initAutoUpdate()).not.toThrow();
  });
});
