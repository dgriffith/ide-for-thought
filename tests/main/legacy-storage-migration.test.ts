/**
 * Carrying localStorage across the file:// → app:// move (#2564): when a
 * window is opened, what the preload gets back, and when the marker is
 * written. Electron is faked; the real-app check is an upgrade from the
 * previous packaged build (see the PR).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

interface Harness {
  userData: string;
  windows: number;
  storage: Record<string, string> | Error;
  onSync: null | ((e: { returnValue?: unknown }) => void);
  trusted: boolean;
}
const h = vi.hoisted((): Harness => ({ userData: '', windows: 0, storage: {}, onSync: null, trusted: true }));

vi.mock('electron', () => ({
  app: { getPath: () => h.userData },
  ipcMain: { on: (_c: string, fn: typeof h.onSync) => { h.onSync = fn; } },
  BrowserWindow: class {
    webContents = {
      executeJavaScript: async () => {
        if (h.storage instanceof Error) throw h.storage;
        return JSON.stringify(h.storage);
      },
    };
    constructor() { h.windows++; }
    loadFile() { return Promise.resolve(); }
    isDestroyed() { return false; }
    destroy() {}
  },
}));
vi.mock('../../src/main/ipc/sender-guard', () => ({ isTrustedIpcSender: () => h.trusted }));
vi.stubGlobal('MAIN_WINDOW_VITE_DEV_SERVER_URL', undefined);

const marker = () => path.join(h.userData, 'storage-origin-migration.json');

async function load() {
  vi.resetModules();
  // The failed-read case logs a warning by design; resetModules gives the
  // module a fresh logger, so mute it on that instance.
  (await import('../../src/shared/logger')).setTagLevel('entrypoint', 'silent');
  const m = await import('../../src/main/legacy-storage-migration');
  m.registerLegacyStorageMigration();
  return m;
}

/** What the preload's sendSync would receive. */
async function ask(): Promise<unknown> {
  const e: { returnValue?: unknown } = {};
  h.onSync!(e);
  await vi.waitFor(() => expect('returnValue' in e).toBe(true));
  return e.returnValue;
}

beforeEach(() => {
  h.userData = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-storage-mig-'));
  h.windows = 0;
  h.storage = {};
  h.trusted = true;
});
afterEach(() => fs.rmSync(h.userData, { recursive: true, force: true }));

describe('legacy storage migration (#2564)', () => {
  it('a profile Chromium created this session (only app:// keys in its .log) is treated as fresh', async () => {
    fs.mkdirSync(path.join(h.userData, 'Local Storage', 'leveldb'), { recursive: true });
    fs.writeFileSync(path.join(h.userData, 'Local Storage', 'leveldb', '000003.log'), 'META:app://minerva\u0000_app://minerva\u0000\u0001x');
    const m = await load();
    m.startLegacyStorageRead();
    expect(await ask()).toBeNull();
    expect(h.windows).toBe(0);
  });

  it('a compacted .ldb table means "maybe" — the read runs', async () => {
    fs.mkdirSync(path.join(h.userData, 'Local Storage', 'leveldb'), { recursive: true });
    fs.writeFileSync(path.join(h.userData, 'Local Storage', 'leveldb', '000005.ldb'), Buffer.from([1, 2, 3]));
    h.storage = { a: '1' };
    const m = await load();
    m.startLegacyStorageRead();
    expect(await ask()).toEqual({ a: '1' });
  });

  it('a fresh profile (no Local Storage) opens no window, hands over nothing, records the marker', async () => {
    const m = await load();
    m.startLegacyStorageRead();
    expect(await ask()).toBeNull();
    expect(h.windows).toBe(0);
    expect(JSON.parse(fs.readFileSync(marker(), 'utf-8')).keys).toBe(0);
  });

  it('an upgraded profile hands the file:// entries over once and records the marker', async () => {
    fs.mkdirSync(path.join(h.userData, 'Local Storage', 'leveldb'), { recursive: true }); fs.writeFileSync(path.join(h.userData, 'Local Storage', 'leveldb', '000003.log'), 'META:file://\u0000_file://\u0000\u0001theme');
    h.storage = { theme: 'dark', 'confirm:delete': '1' };
    const m = await load();
    m.startLegacyStorageRead();
    expect(await ask()).toEqual({ theme: 'dark', 'confirm:delete': '1' });
    expect(h.windows).toBe(1);
    expect(JSON.parse(fs.readFileSync(marker(), 'utf-8')).keys).toBe(2);
    // A reload in the same session gets nothing again.
    expect(await ask()).toBeNull();
  });

  it('a marker from an earlier launch means no window and null', async () => {
    fs.mkdirSync(path.join(h.userData, 'Local Storage', 'leveldb'), { recursive: true }); fs.writeFileSync(path.join(h.userData, 'Local Storage', 'leveldb', '000003.log'), 'META:file://\u0000_file://\u0000\u0001theme');
    fs.writeFileSync(marker(), '{}');
    h.storage = { theme: 'dark' };
    const m = await load();
    m.startLegacyStorageRead();
    expect(await ask()).toBeNull();
    expect(h.windows).toBe(0);
  });

  it('a failed read hands over nothing and writes NO marker, so the next launch retries', async () => {
    fs.mkdirSync(path.join(h.userData, 'Local Storage', 'leveldb'), { recursive: true }); fs.writeFileSync(path.join(h.userData, 'Local Storage', 'leveldb', '000003.log'), 'META:file://\u0000_file://\u0000\u0001theme');
    h.storage = new Error('boom');
    const m = await load();
    m.startLegacyStorageRead();
    expect(await ask()).toEqual({});
    expect(fs.existsSync(marker())).toBe(false);
  });

  it('refuses a sender that is not the renderer', async () => {
    fs.mkdirSync(path.join(h.userData, 'Local Storage', 'leveldb'), { recursive: true }); fs.writeFileSync(path.join(h.userData, 'Local Storage', 'leveldb', '000003.log'), 'META:file://\u0000_file://\u0000\u0001theme');
    h.storage = { theme: 'dark' };
    h.trusted = false;
    await load();
    expect(await ask()).toBeNull();
    expect(h.windows).toBe(0);
  });
});
