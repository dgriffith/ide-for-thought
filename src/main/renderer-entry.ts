/**
 * Where the Minerva renderer lives, and whether a page is it (#2552, #2553).
 *
 * One answer shared by the window that loads the renderer
 * (`window-manager.createWindow`), its navigation guard (`security.ts`) and
 * the IPC sender check (`ipc/sender-guard.ts`), so "the page we loaded" and
 * "the page we trust" can't drift apart.
 */

import path from 'node:path';
import { APP_ENTRY_URL } from './app-protocol-paths';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

/** The packaged renderer bundle's directory — what `app://minerva/` serves. */
export function rendererRoot(): string {
  return path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}`);
}

/** The URL the main window loads: the Vite dev server under `pnpm dev`,
 *  otherwise `app://minerva/index.html` (#2564; it was a `file://` URL). */
export function rendererEntryUrl(): string {
  return MAIN_WINDOW_VITE_DEV_SERVER_URL ?? APP_ENTRY_URL;
}

/** The dev server origin, or undefined in a packaged build. */
export function devServerOrigin(): string | undefined {
  return MAIN_WINDOW_VITE_DEV_SERVER_URL;
}
