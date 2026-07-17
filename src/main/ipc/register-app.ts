import { ipcMain, app, BrowserWindow } from 'electron';
import { Channels } from '../../shared/channels';
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
  ipcMain.handle(Channels.APP_GET_INFO, (): AppInfo => ({
    name: app.getName(),
    version: app.getVersion(),
    commit: typeof __APP_COMMIT__ === 'string' ? __APP_COMMIT__ : 'unknown',
    buildDate: typeof __BUILD_DATE__ === 'string' ? __BUILD_DATE__ : 'unknown',
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  }));

  // Keyboard-shortcut reference for the Help menu (#804).
  ipcMain.handle(Channels.APP_GET_SHORTCUTS, () => getMenuShortcuts());

  // The renderer owns the theme (localStorage); it reports changes so the
  // native View → Theme submenu can show the active radio (#1139).
  ipcMain.on(Channels.MENU_REPORT_THEME, (_e, mode: ThemeMode) => setMenuThemeMode(mode));

  // The renderer owns note/selection state; it reports flips so the native menu
  // can gray out note/selection-only items for the reporting window.
  ipcMain.on(Channels.MENU_REPORT_EDITOR_STATE, (e, state: MenuEditorState) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win) setMenuEditorState(win.id, state);
  });
}
