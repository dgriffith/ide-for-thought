/**
 * Offline YouTube thumbnail cache (#...). Uses a real temp dir for the on-disk
 * cache and a stubbed global `fetch`: a cache hit skips the network, a miss
 * downloads + caches, a bad id or a failed download returns null (renderer
 * falls back to the remote img).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { getOrFetchThumbnail } from '../../../src/main/youtube/thumbnail-cache';

const ID = 'dQw4w9WgXcQ';
let root: string;
const cacheFile = (id: string) => path.join(root, '.minerva', 'cache', 'youtube', `${id}.jpg`);

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-yt-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

function stubFetch(impl: () => Promise<unknown>) {
  vi.stubGlobal('fetch', vi.fn(impl));
}

describe('getOrFetchThumbnail', () => {
  it('returns cached bytes without a network call', async () => {
    await fsp.mkdir(path.dirname(cacheFile(ID)), { recursive: true });
    await fsp.writeFile(cacheFile(ID), Buffer.from([1, 2, 3]));
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const bytes = await getOrFetchThumbnail(root, ID);
    expect(Array.from(bytes!)).toEqual([1, 2, 3]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('downloads, caches to disk, and returns the bytes on a miss', async () => {
    const payload = new Uint8Array([9, 8, 7]);
    stubFetch(async () => ({ ok: true, arrayBuffer: async () => payload.buffer }));

    const bytes = await getOrFetchThumbnail(root, ID);
    expect(Array.from(bytes!)).toEqual([9, 8, 7]);
    // Written to the cache for next time.
    expect(Array.from(await fsp.readFile(cacheFile(ID)))).toEqual([9, 8, 7]);
  });

  it('returns null (and writes nothing) when the download is not ok', async () => {
    stubFetch(async () => ({ ok: false }));
    expect(await getOrFetchThumbnail(root, ID)).toBeNull();
    expect(fs.existsSync(cacheFile(ID))).toBe(false);
  });

  it('returns null when fetch throws (offline)', async () => {
    stubFetch(async () => { throw new Error('ENOTFOUND'); });
    expect(await getOrFetchThumbnail(root, ID)).toBeNull();
  });

  it('rejects an invalid id without touching the network or filesystem', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await getOrFetchThumbnail(root, 'short')).toBeNull();
    expect(await getOrFetchThumbnail(root, '../../etc/passwd')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
