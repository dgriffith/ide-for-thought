/**
 * IPC-registration contract tests (#997).
 *
 * The 19 `src/main/ipc/register-*.ts` modules are the renderer↔main contract
 * surface — they wire channel names to handlers. The underlying operations are
 * well tested, but the registration glue itself (channel-name correctness, no
 * dropped or double-registered handler) had no direct coverage: a renamed
 * channel or a stringly-typed typo would pass `lint` and the unit suite and
 * only surface at runtime.
 *
 * This drives the real `registerIpcHandlers()` against a stubbed `ipcMain` that
 * records every `handle()` channel, then asserts the registration is sound and
 * complete. Electron (and the few main modules that touch native/OS surfaces at
 * import) are mocked to the thinnest shape that lets the registrars load.
 */
import { describe, it, expect, vi } from 'vitest';
import { Channels } from '../../../src/shared/channels';

type Handler = (event: unknown, ...args: unknown[]) => unknown;
const { handled, handlers } = vi.hoisted(() => ({
  handled: [] as string[],
  handlers: new Map<string, Handler>(),
}));

vi.mock('electron', () => {
  const noop = (): undefined => undefined;
  class FakeWindow {
    static getFocusedWindow() { return null; }
    static getAllWindows() { return []; }
    static fromWebContents() { return null; }
    static fromId() { return null; }
    webContents = { send: noop, on: noop, once: noop };
  }
  return {
    ipcMain: {
      handle: (channel: string, fn: Handler) => { handled.push(channel); handlers.set(channel, fn); },
      on: (channel: string, fn: Handler) => { handled.push(channel); handlers.set(channel, fn); },
      removeHandler: noop,
    },
    dialog: { showOpenDialog: noop, showSaveDialog: noop, showMessageBox: noop },
    app: { getPath: () => '/tmp', getName: () => 'minerva', getVersion: () => '0.0.0', on: noop, whenReady: () => Promise.resolve() },
    BrowserWindow: FakeWindow,
    Menu: { buildFromTemplate: (t: unknown) => t, setApplicationMenu: noop },
    shell: { openExternal: noop, showItemInFolder: noop, openPath: noop },
    nativeTheme: { on: noop, shouldUseDarkColors: false },
    clipboard: { writeText: noop, readText: () => '' },
    net: {},
  };
});

import { registerIpcHandlers } from '../../../src/main/ipc';

registerIpcHandlers();

describe('IPC registration contract (#997)', () => {
  it('registers a substantial number of handlers', () => {
    expect(handled.length).toBeGreaterThan(150);
  });

  it('every registered channel is a value defined in shared/channels.ts', () => {
    const known = new Set<string>(Object.values(Channels));
    const unknown = handled.filter((c) => !known.has(c));
    expect(unknown, `stringly-typed / unknown channels: ${unknown.join(', ')}`).toEqual([]);
  });

  it('never registers the same channel twice', () => {
    const seen = new Set<string>();
    const dupes = new Set<string>();
    for (const c of handled) {
      if (seen.has(c)) dupes.add(c);
      seen.add(c);
    }
    expect([...dupes], `double-registered channels: ${[...dupes].join(', ')}`).toEqual([]);
  });

  it('matches the known set of registered channels (snapshot catches drops/renames)', () => {
    expect([...new Set(handled)].sort()).toMatchSnapshot();
  });

  // Prove the harness round-trips a real handler — args in, serializable value
  // out — not just that a channel name was registered. APP_GET_INFO is chosen
  // because it's dependency-light (build metadata + process versions).
  it('round-trips APP_GET_INFO: invoking the handler returns a serializable AppInfo', async () => {
    const handler = handlers.get(Channels.APP_GET_INFO);
    expect(handler, 'APP_GET_INFO handler not registered').toBeDefined();

    const result = await handler!({} /* IpcMainInvokeEvent */);
    // Must survive the structured-clone IPC boundary.
    expect(() => structuredClone(result)).not.toThrow();
    // Deterministic fields prove the registrar wired the electron `app` API and
    // build-time consts through into the handler body.
    expect(result).toMatchObject({
      name: 'minerva',      // from the mocked app.getName()
      version: '0.0.0',     // from the mocked app.getVersion()
      commit: 'unknown',    // __APP_COMMIT__ absent outside a packaged build
      buildDate: 'unknown', // __BUILD_DATE__ absent outside a packaged build
      node: expect.any(String),
    });
    // electron/chrome versions are undefined in a plain-Node test process, but
    // the keys must still be present in the AppInfo shape.
    expect(result).toHaveProperty('electron');
    expect(result).toHaveProperty('chrome');
  });
});
