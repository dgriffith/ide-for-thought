/**
 * BrowserWindow security-flag guard (#1102).
 *
 * `HARDENED_WEB_PREFERENCES` (asserted for its *values* in security.test.ts) is
 * only a boundary if the window construction site actually applies it. This test
 * closes that gap: it drives the real `createWindow` with a captured
 * BrowserWindow and asserts the `webPreferences` handed to Electron keep the
 * renderer sandboxed and isolated with node integration off — the config that
 * makes the preload contextBridge the ONLY main↔renderer path. A regression that
 * drops the spread, or re-enables node after it, would open the renderer to Node
 * and is caught here.
 *
 * electron + app-icon are mocked; the BrowserWindow fake records the options it
 * was constructed with. The real `installNavigationGuards` (from security.ts)
 * runs against the fake webContents — it only wires handlers, so it's harmless.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ constructed: [] as Array<{ webPreferences: Record<string, unknown> }> }));

vi.mock('electron', () => {
  class FakeWebContents {
    on() { /* will-navigate wiring — never fired in this test */ }
    send() { /* project-opened announce — never fired */ }
    setWindowOpenHandler() { /* nav guard wiring */ }
  }
  let idSeq = 1;
  class BrowserWindow {
    id = idSeq++;
    webContents = new FakeWebContents();
    constructor(options: { webPreferences: Record<string, unknown> }) {
      h.constructed.push({ webPreferences: options.webPreferences });
    }
    loadURL() { return Promise.resolve(); }
    loadFile() { return Promise.resolve(); }
    on() { return this; }
    static getAllWindows() { return []; }
  }
  return {
    BrowserWindow,
    // Present so security.ts / transitive modules' `import { … } from 'electron'`
    // bindings resolve; the members are only touched by code paths this test
    // never runs.
    session: { defaultSession: { webRequest: { onHeadersReceived() {} } } },
    shell: { openExternal() {} },
    app: { getPath: () => '/tmp/minerva-test', getAppPath: () => '/tmp/minerva-app' },
  };
});

// appIconPath just returns a filesystem path for the window icon — not security
// relevant, and stubbing it avoids pulling the icon-resolution code into scope.
vi.mock('../../src/main/app-icon', () => ({ appIconPath: () => '/tmp/icon.png' }));

// Vite `define` globals injected at build time. Supply them so createWindow's
// dev-vs-packaged branch resolves (truthy ⇒ the loadURL path, which our fake
// BrowserWindow stubs).
(globalThis as unknown as { MAIN_WINDOW_VITE_DEV_SERVER_URL: string }).MAIN_WINDOW_VITE_DEV_SERVER_URL =
  'http://localhost:5173';
(globalThis as unknown as { MAIN_WINDOW_VITE_NAME: string }).MAIN_WINDOW_VITE_NAME = 'main_window';

import { createWindow } from '../../src/main/window-manager';
import { HARDENED_WEB_PREFERENCES } from '../../src/main/security';

beforeEach(() => {
  h.constructed = [];
});

describe('main BrowserWindow security flags (#1102)', () => {
  it('constructs exactly one window with the hardened webPreferences', () => {
    createWindow();
    expect(h.constructed).toHaveLength(1);
    const wp = h.constructed[0]!.webPreferences;
    expect(wp.contextIsolation).toBe(true);
    expect(wp.nodeIntegration).toBe(false);
    expect(wp.sandbox).toBe(true);
  });

  it('routes the renderer through the preload bridge', () => {
    createWindow();
    const wp = h.constructed[0]!.webPreferences;
    expect(wp.preload).toMatch(/preload\.js$/);
  });

  it('applies the shared HARDENED_WEB_PREFERENCES with no local override re-enabling node', () => {
    createWindow();
    const wp = h.constructed[0]!.webPreferences;
    // The construction site must carry every hardened flag through verbatim…
    expect(wp).toMatchObject(HARDENED_WEB_PREFERENCES);
    // …and must never flip nodeIntegration back on after the spread.
    expect(wp.nodeIntegration).not.toBe(true);
    expect(wp.sandbox).not.toBe(false);
  });
});
