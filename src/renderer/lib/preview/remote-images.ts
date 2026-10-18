/**
 * Drawing a note's remote images (#1332). The preview renders each as
 * `<img class="remote-image" data-remote-src="…">` with NO `src`, so nothing
 * is fetched by rendering; this pass asks main for each (`cacheExternal`),
 * which answers with the bytes when this thoughtbase may load it (or has it
 * cached), and `blocked` with the host when it may not. A blocked image stays
 * hidden behind a placeholder naming its host, with **Load images from <host>**
 * and **Always load images in this thoughtbase**. Run again after the policy
 * changes, it swaps each placeholder whose host is now allowed for its image.
 *
 * Used for markdown images and a typed card's cover; the gallery's covers go
 * through `RemoteCover.svelte`, which asks main the same way.
 */
import { api } from '../ipc/client';
import { remoteImagesStore } from '../stores/remote-images.svelte';
import { logger } from '../../../shared/logger';

/** Bytes from main as a data URL. */
export function toDataUrl(bytes: Uint8Array | ArrayBuffer, mime: string): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < view.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, Array.from(view.subarray(i, i + CHUNK)));
  }
  return `data:${mime || 'application/octet-stream'};base64,${btoa(bin)}`;
}

function placeholderFor(img: HTMLImageElement, host: string): HTMLElement {
  const box = document.createElement('span');
  box.className = 'remote-image-blocked';
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', `Image from ${host}, not loaded`);
  box.dataset.remoteHost = host;
  const what = img.alt ? `“${img.alt}”, an image` : 'An image';
  const text = document.createElement('span');
  text.className = 'rib-text';
  text.textContent = `${what} from ${host}, not loaded: loading it tells ${host} you opened this note.`;
  const one = document.createElement('button');
  one.type = 'button';
  one.textContent = `Load images from ${host}`;
  one.addEventListener('click', (e) => { e.stopPropagation(); void remoteImagesStore.allowHost(host); });
  const all = document.createElement('button');
  all.type = 'button';
  all.textContent = 'Always load images in this thoughtbase';
  all.addEventListener('click', (e) => { e.stopPropagation(); void remoteImagesStore.setMode('allow'); });
  box.append(text, one, all);
  return box;
}

/**
 * Fill in every remote image under `root`. `cache` (url → data URL) is the
 * caller's, so an image already drawn isn't asked for again on a re-render.
 */
export async function gateRemoteImages(root: ParentNode, cache: Map<string, string>): Promise<void> {
  if (typeof api.images?.cacheExternal !== 'function') return;
  const imgs = Array.from(root.querySelectorAll<HTMLImageElement>('img.remote-image[data-remote-src]'));
  await Promise.all(imgs.map(async (img) => {
    const url = img.dataset.remoteSrc;
    if (!url) return;
    // Read at the moment of use, after any await: two passes can be in flight
    // for one image (the render's, and a policy change's), and each must see
    // what the other already did.
    const placeholder = () => (img.previousElementSibling?.classList.contains('remote-image-blocked') ? img.previousElementSibling : null);
    const show = (src: string) => {
      placeholder()?.remove();
      img.hidden = false;
      if (img.src !== src) img.src = src;
    };
    const cached = cache.get(url);
    if (cached) { show(cached); return; }
    try {
      const r = await api.images.cacheExternal(url);
      if (r.status === 'image') {
        const dataUrl = toDataUrl(r.bytes, r.mime);
        cache.set(url, dataUrl);
        show(dataUrl);
      } else if (r.status === 'blocked') {
        img.hidden = true;
        if (!placeholder()) img.before(placeholderFor(img, r.host));
      } else {
        // Allowed, but it couldn't be had (offline, not an image): no longer a
        // question of permission, so the placeholder goes and the image shows
        // as missing.
        placeholder()?.remove();
        img.hidden = false;
        img.classList.add('remote-image-unavailable');
      }
    } catch (err) {
      logger('preview').warn('remote image hydration failed for', url, err);
    }
  }));
}
