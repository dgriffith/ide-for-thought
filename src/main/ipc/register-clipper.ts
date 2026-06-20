/**
 * IPC for the browser-clipper Settings UI (#791): read state, toggle enable,
 * rotate the secret. Config is per-machine (no project context needed).
 */

import { ipcMain } from 'electron';
import { Channels } from '../../shared/channels';
import { encodePairingCode, type ClipperState } from '../../shared/clipper-pairing';
import {
  getClipperConfig,
  setClipperEnabled,
  regenerateClipperSecret,
} from '../clipper/clipper-config';
import { getClipperInfo } from '../clipper/lifecycle';
import { applyClipperConfigChange } from '../window-manager';

async function clipperState(): Promise<ClipperState> {
  const config = await getClipperConfig();
  const info = getClipperInfo();
  const running = info != null;
  const port = info?.port ?? null;
  const pairingCode = running && config.secret ? encodePairingCode(port!, config.secret) : null;
  return { enabled: config.enabled, running, port, secret: config.secret, pairingCode };
}

export function registerClipper(): void {
  ipcMain.handle(Channels.CLIPPER_GET_STATE, () => clipperState());

  ipcMain.handle(Channels.CLIPPER_SET_ENABLED, async (_e, enabled: boolean) => {
    await setClipperEnabled(enabled);
    await applyClipperConfigChange();
    return clipperState();
  });

  ipcMain.handle(Channels.CLIPPER_REGENERATE_SECRET, async () => {
    await regenerateClipperSecret();
    await applyClipperConfigChange();
    return clipperState();
  });
}
