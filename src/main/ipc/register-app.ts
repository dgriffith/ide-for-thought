import { ipcMain, app } from 'electron';
import { Channels } from '../../shared/channels';

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
}
