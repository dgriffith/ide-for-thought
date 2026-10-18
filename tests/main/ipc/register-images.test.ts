/**
 * @vitest-environment node
 *
 * `register-images.ts` (#1332): main enforces the remote-image policy. A
 * remote image is fetched only from a host this thoughtbase allows (or when it
 * allows them all), an already-cached one is served either way, and a blocked
 * one names its host and makes no request. The policy is per thoughtbase,
 * written to userData, and every change is broadcast.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const h = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  sent: [] as Array<[string, unknown]>,
  fetch: vi.fn(),
  userData: '',
  root: '/tb',
}));

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Handler) => { h.handlers.set(channel, fn); } },
  app: { getPath: () => h.userData },
  BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: (c: string, p: unknown) => h.sent.push([c, p]) } }] },
}));
vi.mock('../../../src/main/ipc/helpers', () => ({
  withRootPath: (fn: (root: string, ...a: unknown[]) => unknown) => (_e: unknown, ...a: unknown[]) => {
    if (!h.root) throw new Error('No project open');
    return fn(h.root, ...a);
  },
  withRootPathOr: (fallback: unknown, fn: (root: string, ...a: unknown[]) => unknown) => (_e: unknown, ...a: unknown[]) => (h.root ? fn(h.root, ...a) : fallback),
}));
vi.mock('../../../src/main/images/remote-image-cache', () => ({ getOrFetchRemoteImage: h.fetch }));

import { registerImages } from '../../../src/main/ipc/register-images';
import { Channels } from '../../../src/shared/channels';

const call = async <T>(channel: string, ...args: unknown[]): Promise<T> => await (h.handlers.get(channel)!({}, ...args) as Promise<T>);
const IMAGE = { bytes: new Uint8Array([1, 2]), mime: 'image/png' };

beforeEach(() => {
  h.userData = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-register-images-'));
  h.root = '/tb';
  h.sent.length = 0;
  h.fetch.mockReset();
  h.handlers.clear();
  registerImages();
});
afterEach(() => { fs.rmSync(h.userData, { recursive: true, force: true }); });

describe('register-images (#1332)', () => {
  it('a thoughtbase with no policy asks: a remote image is blocked, naming its host, with no request', async () => {
    h.fetch.mockResolvedValue(null);
    expect(await call(Channels.IMAGES_CACHE_EXTERNAL, 'https://Tracker.example/beacon.png')).toEqual({ status: 'blocked', host: 'tracker.example' });
    expect(h.fetch).toHaveBeenCalledWith('/tb', 'https://Tracker.example/beacon.png', { fetch: false });
  });

  it('an already-cached image is served even when its host isn\'t allowed: that makes no request', async () => {
    h.fetch.mockResolvedValue(IMAGE);
    expect(await call(Channels.IMAGES_CACHE_EXTERNAL, 'https://cdn.example/a.png')).toEqual({ status: 'image', ...IMAGE });
    expect(h.fetch).toHaveBeenCalledWith('/tb', 'https://cdn.example/a.png', { fetch: false });
  });

  it('an allowed host is fetched; others still aren\'t', async () => {
    const policy = await call(Channels.IMAGES_ALLOW_REMOTE_HOST, 'CDN.example');
    expect(policy).toEqual({ mode: 'ask', hosts: ['cdn.example'] });
    h.fetch.mockResolvedValue(IMAGE);
    await call(Channels.IMAGES_CACHE_EXTERNAL, 'https://cdn.example/a.png');
    expect(h.fetch).toHaveBeenLastCalledWith('/tb', 'https://cdn.example/a.png', { fetch: true });
    h.fetch.mockResolvedValue(null);
    expect(await call(Channels.IMAGES_CACHE_EXTERNAL, 'https://other.example/b.png')).toEqual({ status: 'blocked', host: 'other.example' });
  });

  it('`allow` loads every host; an allowed image that can\'t be had is unavailable, not blocked', async () => {
    await call(Channels.IMAGES_SET_REMOTE_MODE, 'allow');
    h.fetch.mockResolvedValue(null);
    expect(await call(Channels.IMAGES_CACHE_EXTERNAL, 'https://anywhere.example/x.png')).toEqual({ status: 'unavailable' });
    expect(h.fetch).toHaveBeenLastCalledWith('/tb', 'https://anywhere.example/x.png', { fetch: true });
  });

  it('never fetches anything but https', async () => {
    expect(await call(Channels.IMAGES_CACHE_EXTERNAL, 'http://lan.local/x.png')).toEqual({ status: 'unavailable' });
    expect(await call(Channels.IMAGES_CACHE_EXTERNAL, 'file:///etc/hosts')).toEqual({ status: 'unavailable' });
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it('the policy is per thoughtbase, kept in userData, and each change is broadcast', async () => {
    await call(Channels.IMAGES_ALLOW_REMOTE_HOST, 'cdn.example');
    h.root = '/other';
    expect(await call(Channels.IMAGES_REMOTE_POLICY)).toEqual({ mode: 'ask', hosts: [] });
    const stored = JSON.parse(fs.readFileSync(path.join(h.userData, 'remote-images.json'), 'utf-8')) as { thoughtbases: Record<string, unknown> };
    expect(stored.thoughtbases['/tb']).toEqual({ mode: 'ask', hosts: ['cdn.example'] });
    expect(h.sent).toEqual([[Channels.IMAGES_REMOTE_POLICY_CHANGED, { rootPath: '/tb', policy: { mode: 'ask', hosts: ['cdn.example'] } }]]);
  });

  it('a reset forgets the hosts and asks again; an unknown mode is `ask`; a non-host is refused', async () => {
    await call(Channels.IMAGES_ALLOW_REMOTE_HOST, 'cdn.example');
    await call(Channels.IMAGES_SET_REMOTE_MODE, 'allow');
    expect(await call(Channels.IMAGES_RESET_REMOTE_POLICY)).toEqual({ mode: 'ask', hosts: [] });
    expect(await call(Channels.IMAGES_SET_REMOTE_MODE, 'everything')).toEqual({ mode: 'ask', hosts: [] });
    await expect(call(Channels.IMAGES_ALLOW_REMOTE_HOST, 'evil.example/../x')).rejects.toThrow(/isn't a host name/);
  });

  it('with no thoughtbase open, the policy reads as `ask` and the rest refuse', async () => {
    h.root = null;
    expect(await call(Channels.IMAGES_REMOTE_POLICY)).toEqual({ mode: 'ask', hosts: [] });
    await expect(call(Channels.IMAGES_CACHE_EXTERNAL, 'https://cdn.example/a.png')).rejects.toThrow(/No project open/);
  });
});
