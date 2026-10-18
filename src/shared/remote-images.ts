/**
 * Remote images in notes (#1332): `![](https://…)`, a gallery cover, a typed
 * card's cover. Drawing one makes a request to a host the note chose, which
 * tells that host the note was opened, when and from where: a read beacon in a
 * shared thoughtbase. So a remote image loads only from a host the user has
 * allowed in that thoughtbase, or in a thoughtbase set to load them all; until
 * then it's a placeholder naming its host.
 *
 * The policy is per thoughtbase and per machine (`userData/remote-images.json`),
 * never in the thoughtbase: a shared thoughtbase must not be able to
 * pre-authorize its own beacons.
 */

/** `allow`: load every remote image. `ask`: only allowed hosts', a placeholder for the rest. */
export type RemoteImageMode = 'allow' | 'ask';

export interface RemoteImagePolicy {
  mode: RemoteImageMode;
  /** Hosts allowed in this thoughtbase while it's `ask`, lowercase. */
  hosts: string[];
}

/** What the renderer gets for one remote image. Only `image` puts anything on screen. */
export type RemoteImageResult =
  | { status: 'image'; bytes: Uint8Array; mime: string }
  /** Not loaded: its host isn't allowed here. Nothing was requested. */
  | { status: 'blocked'; host: string }
  /** Allowed, but it couldn't be had: offline, not an image, too big. */
  | { status: 'unavailable' };

/** The host a remote image URL would contact, lowercase; null for anything not https. */
export function remoteImageHost(url: string): string | null {
  try {
    const u = new URL(url.startsWith('//') ? `https:${url}` : url);
    return u.protocol === 'https:' ? u.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}
