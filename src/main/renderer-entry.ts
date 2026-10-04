/**
 * Where the Minerva renderer lives, and whether a page is it (#2552, #2553).
 *
 * One answer shared by the window that loads the renderer
 * (`window-manager.createWindow`), its navigation guard (`security.ts`) and
 * the IPC sender check (`ipc/sender-guard.ts`), so "the page we loaded" and
 * "the page we trust" can't drift apart.
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

/** Absolute path of the packaged renderer's `index.html`. */
export function rendererEntryPath(): string {
  return path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`);
}

/** The URL the main window loads: the Vite dev server under `pnpm dev`,
 *  otherwise the file URL of `rendererEntryPath()`. */
export function rendererEntryUrl(): string {
  return MAIN_WINDOW_VITE_DEV_SERVER_URL ?? pathToFileURL(rendererEntryPath()).href;
}

/** The dev server origin, or undefined in a packaged build. */
export function devServerOrigin(): string | undefined {
  return MAIN_WINDOW_VITE_DEV_SERVER_URL;
}
