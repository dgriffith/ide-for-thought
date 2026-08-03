/**
 * Typed one-way (main → renderer) broadcast (#1633). The main-side mirror of the
 * invoke `handle`: the channel + payload are checked against `EventMap`, so a
 * sender that disagrees with the renderer's subscriber fails `tsc` instead of the
 * payload arriving as `unknown`.
 *
 * A leaf module (electron + a type-only contract import) so every layer — the
 * watcher, window-manager, menu, and the register-* handlers — can call it
 * without an import cycle through `ipc/helpers`.
 */
import type { BrowserWindow } from 'electron';
import type { EventMap } from '../../shared/ipc-contract';

export function broadcast<K extends keyof EventMap>(
  win: BrowserWindow,
  channel: K,
  ...args: Parameters<EventMap[K]>
): void {
  win.webContents.send(channel, ...args);
}
