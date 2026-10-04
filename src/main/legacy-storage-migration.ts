/**
 * Carry the renderer's localStorage across the `file://` → `app://` move
 * (#2564).
 *
 * Web storage is keyed by origin. The renderer used to run at `file://`; it
 * runs at `app://minerva` now, so on the first launch after the upgrade its
 * localStorage would be empty — theme, editor and sidebar settings, every
 * "Don't ask again" choice, layout state — silently reset.
 *
 * So, once: main opens a hidden window on a `file://` page (all `file://`
 * pages share one storage origin), reads every entry with
 * `executeJavaScript`, and closes it. The main window's preload asks for the
 * entries with a synchronous IPC call before any page script runs, and writes
 * each key the new origin doesn't already have. A marker in userData records
 * that it happened, so every later launch answers `null` without opening
 * anything.
 *
 * Nothing waits for this in front of the window (#2223): the read starts when
 * the page's preload asks, and only that preload blocks on it — once, on the
 * first launch after the upgrade, for the ~100-300ms a hidden window takes.
 * IndexedDB / Cache Storage are not carried over: the only user of either is
 * the Whisper model cache, which re-downloads.
 */
import { app, BrowserWindow, ipcMain } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Channels } from '../shared/channels';
import { isTrustedIpcSender } from './ipc/sender-guard';
import { logger } from '../shared/logger';
import { isEnoent, writeJsonFileAtomicSync } from './config/json-file';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;

type Entries = Record<string, string>;

function markerPath(): string {
  return path.join(app.getPath('userData'), 'storage-origin-migration.json');
}

const READ_ENTRIES = `JSON.stringify(Object.fromEntries(
  Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
    .filter((k) => k !== null)
    .map((k) => [k, localStorage.getItem(k)])
))`;

/** Longest the preload may be kept waiting; past it the page starts fresh. */
const READ_TIMEOUT_MS = 5_000;

/** Every localStorage entry the `file://` origin holds; rejects on failure or timeout. */
async function readFileOriginStorage(): Promise<Entries> {
  const page = path.join(os.tmpdir(), `minerva-storage-migration-${process.pid}.html`);
  fs.writeFileSync(page, '<!doctype html><title>migration</title>');
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // With GrantFileProtocolExtraPrivileges off, a `file://` page is an
      // opaque origin and sees an empty localStorage — not the `file://`
      // storage the old renderer wrote (measured: 0 keys). `webSecurity:
      // false` sets Chromium's allow-file-access-from-file-urls for THIS page
      // only, which is the privilege the fuse used to grant every `file://`
      // page. Contained: no preload, one blank page Minerva just wrote, one
      // read, destroyed — no other content ever loads here.
      webSecurity: false,
    },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${READ_TIMEOUT_MS}ms`)), READ_TIMEOUT_MS);
  });
  try {
    await Promise.race([win.loadFile(page), timeout]);
    const raw = (await Promise.race([win.webContents.executeJavaScript(READ_ENTRIES, true), timeout])) as string;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string'),
    );
  } finally {
    clearTimeout(timer);
    if (!win.isDestroyed()) win.destroy();
    fs.rmSync(page, { force: true });
  }
}

function writeMarker(keys: number): void {
  try {
    writeJsonFileAtomicSync(markerPath(), { from: 'file://', to: 'app://minerva', at: new Date().toISOString(), keys });
  } catch (e) {
    logger('entrypoint').warn('could not record the storage migration:', e);
  }
}

/**
 * Could this profile's localStorage hold entries from the `file://` origin?
 * Chromium creates `Local Storage/leveldb` itself at startup, so the
 * directory existing proves nothing. A profile written only this session
 * (fresh) holds just write-ahead `.log` files with no `file://` keys in them.
 * So: yes if any compacted `.ldb` table exists (its blocks may be compressed,
 * so it can't be searched reliably) or any `.log` mentions `file://`. Errs
 * towards yes — a needless read costs one hidden window, a wrong no would
 * lose the user's settings.
 */
function mayHoldFileOriginStorage(): boolean {
  const dir = path.join(app.getPath('userData'), 'Local Storage', 'leveldb');
  let files: string[];
  try {
    files = fs.readdirSync(dir);
  } catch (e) {
    if (isEnoent(e)) return false;
    return true;
  }
  if (files.some((f) => f.endsWith('.ldb'))) return true;
  return files
    .filter((f) => f.endsWith('.log'))
    .some((f) => fs.readFileSync(path.join(dir, f)).includes('file://'));
}

let pending: Promise<Entries | null> | null = null;
/** A failed read hands over nothing AND leaves no marker, so the next launch retries. */
let readFailed = false;

/**
 * Start reading the old origin's entries (once per process), unless the
 * migration already happened, there's nothing to migrate, or the renderer
 * isn't on `app://` (dev server). Started by the preload's request — after
 * the main page exists, so the hidden reader window is never the app's
 * "first window" to anything waiting for one.
 */
export function startLegacyStorageRead(): void {
  if (pending) return;
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL || fs.existsSync(markerPath())) {
    pending = Promise.resolve(null);
    return;
  }
  // A profile that never had file:// storage — a fresh install, or a fresh
  // test profile — has nothing to carry. Record that and open no window.
  if (!mayHoldFileOriginStorage()) {
    writeMarker(0);
    pending = Promise.resolve(null);
    return;
  }
  pending = readFileOriginStorage().catch((e: unknown) => {
    logger('entrypoint').warn('could not read the file:// localStorage to migrate it:', e);
    readFailed = true;
    return {};
  });
}

/** The IPC side: hand the entries to the renderer's preload, once. */
export function registerLegacyStorageMigration(): void {
  ipcMain.on(Channels.STORAGE_LEGACY_ORIGIN_ENTRIES, (event) => {
    if (!isTrustedIpcSender(event)) {
      event.returnValue = null;
      return;
    }
    startLegacyStorageRead();
    void pending!.then((entries) => {
      event.returnValue = entries;
      if (entries === null) return;
      // Handed over: later page loads and launches answer null.
      pending = Promise.resolve(null);
      if (readFailed) return;
      writeMarker(Object.keys(entries).length);
    });
  });
}
