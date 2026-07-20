/**
 * Offline cache for external `![](https://…)` images (#...). Real temp dir for
 * the on-disk cache + a stubbed global `fetch`: a hit skips the network, a miss
 * downloads + caches (bytes + mime), and a bad URL / non-image / oversized /
 * failed response returns null (renderer falls back to the remote <img>).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

import { getOrFetchRemoteImage } from '../../../src/main/images/remote-image-cache';

const URL_ = 'https://example.com/pic.png';
let root: string;
const key = crypto.createHash('sha256').update(URL_).digest('hex');
const bytesFile = () => path.join(root, '.minerva', 'cache', 'external-images', key);
const mimeFile = () => path.join(root, '.minerva', 'cache', 'external-images', `${key}.mime`);

/** A minimal Response-like for the fetch stub. */
function res(opts: {
  ok?: boolean; contentType?: string; contentLength?: string; body?: Uint8Array;
}) {
  const headers = new Map<string, string>();
  if (opts.contentType) headers.set('content-type', opts.contentType);
  if (opts.contentLength) headers.set('content-length', opts.contentLength);
  return {
    ok: opts.ok ?? true,
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
    arrayBuffer: async () => (opts.body ?? new Uint8Array()).buffer,
  };
}
function stubFetch(impl: () => Promise<unknown>) {
  vi.stubGlobal('fetch', vi.fn(impl));
}

beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-img-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); vi.unstubAllGlobals(); });

describe('getOrFetchRemoteImage', () => {
  it('returns cached bytes + mime without a network call', async () => {
    await fsp.mkdir(path.dirname(bytesFile()), { recursive: true });
    await fsp.writeFile(bytesFile(), Buffer.from([1, 2, 3]));
    await fsp.writeFile(mimeFile(), 'image/png');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const out = await getOrFetchRemoteImage(root, URL_);
    expect(Array.from(out!.bytes)).toEqual([1, 2, 3]);
    expect(out!.mime).toBe('image/png');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('downloads, caches bytes + mime, and returns them on a miss', async () => {
    stubFetch(async () => res({ contentType: 'image/jpeg', body: new Uint8Array([9, 8]) }));
    const out = await getOrFetchRemoteImage(root, URL_);
    expect(Array.from(out!.bytes)).toEqual([9, 8]);
    expect(out!.mime).toBe('image/jpeg');
    expect(Array.from(await fsp.readFile(bytesFile()))).toEqual([9, 8]);
    expect(await fsp.readFile(mimeFile(), 'utf-8')).toBe('image/jpeg');
  });

  it('strips charset params from the content type', async () => {
    stubFetch(async () => res({ contentType: 'image/svg+xml; charset=utf-8', body: new Uint8Array([1]) }));
    expect((await getOrFetchRemoteImage(root, URL_))!.mime).toBe('image/svg+xml');
  });

  it('returns null (nothing cached) for a non-image response', async () => {
    stubFetch(async () => res({ contentType: 'text/html', body: new Uint8Array([1]) }));
    expect(await getOrFetchRemoteImage(root, URL_)).toBeNull();
    expect(fs.existsSync(bytesFile())).toBe(false);
  });

  it('returns null when the declared size exceeds the cap', async () => {
    stubFetch(async () => res({ contentType: 'image/png', contentLength: String(50 * 1024 * 1024) }));
    expect(await getOrFetchRemoteImage(root, URL_)).toBeNull();
  });

  it('returns null on a non-ok response and on a thrown fetch (offline)', async () => {
    stubFetch(async () => res({ ok: false }));
    expect(await getOrFetchRemoteImage(root, URL_)).toBeNull();
    stubFetch(async () => { throw new Error('ENOTFOUND'); });
    expect(await getOrFetchRemoteImage(root, URL_)).toBeNull();
  });

  it('rejects non-http(s) and malformed URLs without a network call', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await getOrFetchRemoteImage(root, 'file:///etc/passwd')).toBeNull();
    expect(await getOrFetchRemoteImage(root, 'data:image/png;base64,AAAA')).toBeNull();
    expect(await getOrFetchRemoteImage(root, 'not a url')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
