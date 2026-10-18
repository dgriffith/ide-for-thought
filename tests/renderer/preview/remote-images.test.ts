/**
 * @vitest-environment happy-dom
 *
 * A note's remote images (#1332). The preview renders each with no `src`; this
 * pass asks main, and draws it only when main hands back bytes. A blocked one
 * stays hidden behind a placeholder naming its host, whose buttons allow that
 * host or the whole thoughtbase; run again after that, the placeholder gives
 * way to the image. At no point does a remote URL reach an `src`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  cacheExternal: vi.fn(),
  allowRemoteHost: vi.fn(async (host: string) => ({ mode: 'ask', hosts: [host] })),
  setRemoteMode: vi.fn(async (mode: string) => ({ mode, hosts: [] })),
}));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: { images: { cacheExternal: h.cacheExternal, allowRemoteHost: h.allowRemoteHost, setRemoteMode: h.setRemoteMode, resetRemotePolicy: vi.fn(), remotePolicy: vi.fn() } },
}));

import { gateRemoteImages } from '../../../src/renderer/lib/preview/remote-images';

const IMAGE = { status: 'image', bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' };

function preview(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}
const noRemoteSrc = (root: HTMLElement) => [...root.querySelectorAll('img')].every((i) => !/^https?:|^\/\//.test(i.getAttribute('src') ?? ''));

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

describe('gateRemoteImages (#1332)', () => {
  it('a blocked image is hidden behind a placeholder naming its host; nothing remote reaches src', async () => {
    h.cacheExternal.mockResolvedValue({ status: 'blocked', host: 'tracker.example' });
    const root = preview('<p><img class="remote-image" data-remote-src="https://tracker.example/b.png" alt="Chart"></p>');
    await gateRemoteImages(root, new Map());
    const img = root.querySelector('img')!;
    expect(img.hidden).toBe(true);
    const box = root.querySelector('.remote-image-blocked')!;
    expect(box.getAttribute('aria-label')).toBe('Image from tracker.example, not loaded');
    expect(box.textContent).toContain('“Chart”, an image from tracker.example, not loaded');
    expect([...box.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Load images from tracker.example', 'Always load images in this thoughtbase']);
    expect(noRemoteSrc(root)).toBe(true);
  });

  it('its buttons allow the host, or the whole thoughtbase', async () => {
    h.cacheExternal.mockResolvedValue({ status: 'blocked', host: 'cdn.example' });
    const root = preview('<img class="remote-image" data-remote-src="https://cdn.example/a.png">');
    await gateRemoteImages(root, new Map());
    const [one, all] = [...root.querySelectorAll<HTMLButtonElement>('.remote-image-blocked button')];
    one!.click();
    expect(h.allowRemoteHost).toHaveBeenCalledWith('cdn.example');
    all!.click();
    expect(h.setRemoteMode).toHaveBeenCalledWith('allow');
  });

  it('run again once allowed, the placeholder gives way to the image, drawn from main\'s bytes', async () => {
    h.cacheExternal.mockResolvedValueOnce({ status: 'blocked', host: 'cdn.example' });
    const root = preview('<img class="remote-image" data-remote-src="https://cdn.example/a.png">');
    const cache = new Map<string, string>();
    await gateRemoteImages(root, cache);
    await gateRemoteImages(root, cache); // a second pass while still blocked adds no second placeholder
    expect(root.querySelectorAll('.remote-image-blocked')).toHaveLength(1);

    h.cacheExternal.mockResolvedValueOnce(IMAGE);
    await gateRemoteImages(root, cache);
    const img = root.querySelector('img')!;
    expect(root.querySelector('.remote-image-blocked')).toBeNull();
    expect(img.hidden).toBe(false);
    expect(img.getAttribute('src')).toBe('data:image/png;base64,AQID');
    expect(cache.get('https://cdn.example/a.png')).toBe('data:image/png;base64,AQID');
  });

  it('a card\'s cover goes through the same gate', async () => {
    h.cacheExternal.mockResolvedValue(IMAGE);
    const card = preview('<span class="oc-cover"><img class="remote-image" data-remote-src="https://x/dune.png" alt=""></span>');
    await gateRemoteImages(card, new Map());
    expect(card.querySelector('img')!.getAttribute('src')).toMatch(/^data:image\/png/);
  });
});

describe('two passes at once (#1332)', () => {
  it('one image never gets two placeholders, however the passes interleave', async () => {
    h.cacheExternal.mockResolvedValue({ status: 'blocked', host: 'cdn.example' });
    const root = preview('<img class="remote-image" data-remote-src="https://cdn.example/a.png">');
    await Promise.all([gateRemoteImages(root, new Map()), gateRemoteImages(root, new Map())]);
    expect(root.querySelectorAll('.remote-image-blocked')).toHaveLength(1);
  });
});

describe('allowed but unavailable (#1332)', () => {
  it('drops the placeholder once its host is allowed, even if the image can\'t be had', async () => {
    h.cacheExternal.mockResolvedValueOnce({ status: 'blocked', host: 'cdn.example' });
    const root = preview('<img class="remote-image" data-remote-src="https://cdn.example/a.png">');
    await gateRemoteImages(root, new Map());
    h.cacheExternal.mockResolvedValueOnce({ status: 'unavailable' });
    await gateRemoteImages(root, new Map());
    expect(root.querySelector('.remote-image-blocked')).toBeNull();
    const img = root.querySelector('img')!;
    expect(img.hidden).toBe(false);
    expect(img.classList.contains('remote-image-unavailable')).toBe(true);
    expect(img.getAttribute('src')).toBeNull();
  });
});
