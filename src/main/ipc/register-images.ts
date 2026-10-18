/**
 * Remote images in notes (#1332): the cached-or-fetched bytes of one, and the
 * per-thoughtbase policy that says whether fetching it is allowed.
 *
 * `IMAGES_CACHE_EXTERNAL` is where the policy is enforced: it fetches only a
 * URL whose host this thoughtbase allows (or when it allows them all), and
 * serves an already-cached copy either way, since that makes no request. The
 * renderer never puts a remote URL in an `<img>`, so this is the only way a
 * note's remote image reaches the screen.
 *
 * The policy lives in `userData/remote-images.json`, per machine, so a shared
 * thoughtbase can't pre-authorize its own beacons. A change is broadcast to
 * every window, so each preview re-draws what it now may load.
 */
import path from 'node:path';
import { app, BrowserWindow } from 'electron';
import { Channels } from '../../shared/channels';
import { remoteImageHost, type RemoteImageMode, type RemoteImagePolicy, type RemoteImageResult } from '../../shared/remote-images';
import { getOrFetchRemoteImage } from '../images/remote-image-cache';
import {
  allowRemoteImageHost,
  configureRemoteImagePolicyPath,
  mayFetchRemoteImage,
  remoteImagePolicy,
  resetRemoteImagePolicy,
  setRemoteImageMode,
} from '../images/remote-image-policy';
import { handle } from './typed-ipc';
import { withRootPath, withRootPathOr } from './helpers';

function changed(rootPath: string, policy: RemoteImagePolicy): RemoteImagePolicy {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(Channels.IMAGES_REMOTE_POLICY_CHANGED, { rootPath, policy });
  }
  return policy;
}

export function registerImages(): void {
  configureRemoteImagePolicyPath(path.join(app.getPath('userData'), 'remote-images.json'));

  handle(Channels.IMAGES_CACHE_EXTERNAL, withRootPath(async (rootPath, url: string): Promise<RemoteImageResult> => {
    const host = remoteImageHost(url);
    if (!host) return { status: 'unavailable' };
    const allowed = mayFetchRemoteImage(rootPath, url);
    const image = await getOrFetchRemoteImage(rootPath, url, { fetch: allowed });
    if (image) return { status: 'image', bytes: image.bytes, mime: image.mime };
    return allowed ? { status: 'unavailable' } : { status: 'blocked', host };
  }));

  handle(Channels.IMAGES_REMOTE_POLICY, withRootPathOr<[], RemoteImagePolicy>({ mode: 'ask', hosts: [] }, (rootPath) =>
    remoteImagePolicy(rootPath)));

  handle(Channels.IMAGES_ALLOW_REMOTE_HOST, withRootPath((rootPath, host: string) =>
    changed(rootPath, allowRemoteImageHost(rootPath, String(host)))));

  handle(Channels.IMAGES_SET_REMOTE_MODE, withRootPath((rootPath, mode: RemoteImageMode) =>
    changed(rootPath, setRemoteImageMode(rootPath, mode === 'allow' ? 'allow' : 'ask'))));

  handle(Channels.IMAGES_RESET_REMOTE_POLICY, withRootPath((rootPath) =>
    changed(rootPath, resetRemoteImagePolicy(rootPath))));
}
