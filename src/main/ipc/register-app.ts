import os from 'node:os';
import { ipcMain, app, BrowserWindow } from 'electron';
import { Channels } from '../../shared/channels';
import { handle } from './typed-ipc';
import { isTrustedIpcSender } from './sender-guard';
import { createSystemAudioTaps, supportsSystemAudioCapture } from '../system-audio-tap';
import { broadcast } from './broadcast';
import { getMenuShortcuts, setMenuThemeMode, setMenuEditorState } from '../menu';
import type { ThemeMode } from '../../shared/theme';
import type { MenuEditorState } from '../../shared/types';

// Injected by vite.main.config.ts `define` at build time — a packaged app has
// no git to query at runtime, so the commit + date are baked in.
declare const __APP_COMMIT__: string;
declare const __BUILD_DATE__: string;

export interface AppInfo {
  name: string;
  version: string;
  commit: string;
  buildDate: string;
  electron: string;
  chrome: string;
  node: string;
}

/** App/build metadata for the About dialog (#803). */
export function registerApp(): void {
  handle(Channels.APP_GET_INFO, (): AppInfo => ({
    name: app.getName(),
    version: app.getVersion(),
    commit: typeof __APP_COMMIT__ === 'string' ? __APP_COMMIT__ : 'unknown',
    buildDate: typeof __BUILD_DATE__ === 'string' ? __BUILD_DATE__ : 'unknown',
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  }));

  // Keyboard-shortcut reference for the Help menu (#804).
  handle(Channels.APP_GET_SHORTCUTS, () => getMenuShortcuts());

  // The OS locale with its region, for the Calendar's Automatic week start
  // (#2702): the renderer's `navigator.language` is the language alone.
  handle(Channels.APP_GET_SYSTEM_LOCALE, () => app.getSystemLocale());

  // Meeting recordings (#2731): system audio, through the bundled Core Audio
  // tap helper (`system-audio-tap.ts`), on macOS 14.2+. Its PCM goes only to
  // the window that started it, and stops when that window goes.
  handle(Channels.APP_SUPPORTS_SYSTEM_AUDIO, () => supportsSystemAudioCapture(process.platform, os.release()));
  const taps = createSystemAudioTaps();
  handle(Channels.APP_START_SYSTEM_AUDIO, (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) throw new Error('No window to record system audio for.');
    const owner = e.sender.id;
    e.sender.once('destroyed', () => taps.stop(owner));
    return taps.start(owner, (chunk) => {
      if (!win.isDestroyed()) broadcast(win, Channels.APP_SYSTEM_AUDIO, chunk);
    });
  });
  handle(Channels.APP_STOP_SYSTEM_AUDIO, (e) => { taps.stop(e.sender.id); });

  // The renderer owns the theme (localStorage); it reports changes so the
  // native View → Theme submenu can show the active radio (#1139).
  ipcMain.on(Channels.MENU_REPORT_THEME, (e, mode: ThemeMode) => {
    if (isTrustedIpcSender(e)) setMenuThemeMode(mode);
  });

  // The renderer owns note/selection state; it reports flips so the native menu
  // can gray out note/selection-only items for the reporting window.
  ipcMain.on(Channels.MENU_REPORT_EDITOR_STATE, (e, state: MenuEditorState) => {
    if (!isTrustedIpcSender(e)) return;
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win) setMenuEditorState(win.id, state);
  });
}
