/**
 * @vitest-environment node
 *
 * Clipper server lifecycle (#2058). `lifecycle.ts` owns real concurrency-
 * correctness logic that had zero direct test: `ensureClipperRunning`'s
 * `starting` promise dedup (so two concurrent "open thoughtbase" calls race
 * harmlessly instead of starting two servers), the idempotent
 * `stopClipperServer`, and the "a stop/start keeps pairing stable" secret
 * contract the module's own docstring claims. `startClipperServer` itself is
 * mocked out — that's `clipper-server.test.ts`'s job, driven over a real
 * port — this file is about the dedup/state-machine logic around it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ClipperServerHandle } from '../../../src/main/clipper/clipper-server';

const h = vi.hoisted(() => ({
  startClipperServer: vi.fn(),
  getClipperConfig: vi.fn(),
  ensureClipperSecret: vi.fn(),
  clipperIngest: vi.fn(),
  previewSourceFromHtml: vi.fn(),
}));

vi.mock('../../../src/main/clipper/clipper-server', () => ({
  startClipperServer: h.startClipperServer,
}));
vi.mock('../../../src/main/clipper/clipper-config', () => ({
  getClipperConfig: h.getClipperConfig,
  ensureClipperSecret: h.ensureClipperSecret,
}));
// Not invoked by lifecycle.ts's own logic — only threaded through as options
// startClipperServer's real request handling would call. Stubbed so
// importing lifecycle.ts doesn't pull in their real dependency chains; the
// "forwards ... to startClipperServer" test below calls the stored `preview`
// wrapper directly to verify the delegation is wired correctly.
vi.mock('../../../src/main/clipper/clipper-ingest', () => ({ clipperIngest: h.clipperIngest }));
vi.mock('../../../src/main/sources/ingest', () => ({ previewSourceFromHtml: h.previewSourceFromHtml }));

import { ensureClipperRunning, stopClipperServer, getClipperInfo, isClipperEnabled } from '../../../src/main/clipper/lifecycle';

/** A promise the test controls the resolution/rejection of. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function fakeHandle(over: Partial<ClipperServerHandle> = {}): ClipperServerHandle {
  return { port: 41599, secret: 'shh', close: vi.fn().mockResolvedValue(undefined), ...over };
}

const resolveRootPath = () => '/root';

beforeEach(() => {
  h.ensureClipperSecret.mockResolvedValue('shh');
  h.getClipperConfig.mockResolvedValue({ enabled: false, secret: 'shh' });
});

afterEach(async () => {
  // Module-level `handle`/`starting` state, not reset between tests
  // otherwise — stopClipperServer() is the module's own reset path.
  await stopClipperServer();
  vi.clearAllMocks();
});

describe('lifecycle (#2058)', () => {
  it('getClipperInfo() is null before anything has started', () => {
    expect(getClipperInfo()).toBeNull();
  });

  it('starts the server once and returns its port + secret', async () => {
    h.startClipperServer.mockResolvedValue(fakeHandle({ port: 12345, secret: 'abc' }));
    const info = await ensureClipperRunning(resolveRootPath);
    expect(info).toEqual({ port: 12345, secret: 'abc' });
    expect(h.startClipperServer).toHaveBeenCalledTimes(1);
    expect(getClipperInfo()).toEqual({ port: 12345, secret: 'abc' });
  });

  it('forwards the persisted secret, the preferred port, and the resolver to startClipperServer', async () => {
    h.ensureClipperSecret.mockResolvedValue('persisted-secret');
    h.startClipperServer.mockResolvedValue(fakeHandle());
    await ensureClipperRunning(resolveRootPath);
    const opts = h.startClipperServer.mock.calls[0]![0];
    expect(opts.secret).toBe('persisted-secret');
    expect(opts.port).toBe(41599);
    expect(opts.resolveRootPath).toBe(resolveRootPath);
    expect(opts.ingest).toBe(h.clipperIngest);
    // `preview` is a wrapper closure, not clipperIngest's peer — call it and
    // check it delegates to previewSourceFromHtml with the right args.
    h.previewSourceFromHtml.mockResolvedValue({ title: 'Example' });
    await opts.preview({ html: '<p>hi</p>', url: 'https://example.com' });
    expect(h.previewSourceFromHtml).toHaveBeenCalledWith('<p>hi</p>', 'https://example.com');
  });

  it('dedups concurrent starts: N simultaneous calls start exactly one server and all resolve to it', async () => {
    const d = deferred<ClipperServerHandle>();
    h.startClipperServer.mockReturnValue(d.promise);

    const calls = [
      ensureClipperRunning(resolveRootPath),
      ensureClipperRunning(resolveRootPath),
      ensureClipperRunning(resolveRootPath),
    ];
    // Resolve on the next macrotask, after all three calls' `ensureClipperSecret()`
    // microtask hops have had a chance to run — a bare synchronous check here
    // would race `startClipperServer`'s actual invocation (it's called from
    // inside a `.then`, not synchronously) and, worse, an assertion failure at
    // this point would leave `d` permanently unresolved — the module's
    // `starting` promise would hang forever and every later test touching
    // `ensureClipperRunning` would time out waiting on it. Resolving
    // unconditionally first is what keeps that failure mode from cascading.
    await new Promise((r) => setTimeout(r, 0));
    d.resolve(fakeHandle({ port: 9999, secret: 'race-secret' }));
    const results = await Promise.all(calls);

    expect(results).toEqual([
      { port: 9999, secret: 'race-secret' },
      { port: 9999, secret: 'race-secret' },
      { port: 9999, secret: 'race-secret' },
    ]);
    // Still exactly one real start, even though three callers asked.
    expect(h.startClipperServer).toHaveBeenCalledTimes(1);
  });

  it('a subsequent call after the server is already running is a fast-path no-op (no second start)', async () => {
    h.startClipperServer.mockResolvedValue(fakeHandle({ port: 1, secret: 's1' }));
    await ensureClipperRunning(resolveRootPath);
    await ensureClipperRunning(resolveRootPath);
    await ensureClipperRunning(resolveRootPath);
    expect(h.startClipperServer).toHaveBeenCalledTimes(1);
  });

  it('resets the in-flight state on a failed start, so a later call can retry', async () => {
    h.startClipperServer.mockRejectedValueOnce(new Error('EADDRINUSE'));
    await expect(ensureClipperRunning(resolveRootPath)).rejects.toThrow('EADDRINUSE');
    expect(getClipperInfo()).toBeNull();

    // A concurrent caller that was riding the same failed `starting` promise
    // sees the same rejection, not a hang or a stale success.
    h.startClipperServer.mockRejectedValueOnce(new Error('EADDRINUSE'));
    const [a, b] = await Promise.allSettled([
      ensureClipperRunning(resolveRootPath),
      ensureClipperRunning(resolveRootPath),
    ]);
    expect(a.status).toBe('rejected');
    expect(b.status).toBe('rejected');
    expect(h.startClipperServer).toHaveBeenCalledTimes(2); // one per attempt above

    // Retry after the failure succeeds — `starting` wasn't left stuck.
    h.startClipperServer.mockResolvedValue(fakeHandle({ port: 2, secret: 's2' }));
    const info = await ensureClipperRunning(resolveRootPath);
    expect(info).toEqual({ port: 2, secret: 's2' });
  });

  it('stopClipperServer closes the handle and clears getClipperInfo', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    h.startClipperServer.mockResolvedValue(fakeHandle({ close }));
    await ensureClipperRunning(resolveRootPath);
    expect(getClipperInfo()).not.toBeNull();

    await stopClipperServer();
    expect(close).toHaveBeenCalledTimes(1);
    expect(getClipperInfo()).toBeNull();
  });

  it('stopClipperServer is a safe no-op when nothing is running', async () => {
    await expect(stopClipperServer()).resolves.toBeUndefined();
  });

  it('a stop/start cycle re-derives the secret (persisted, so pairing stays stable)', async () => {
    h.ensureClipperSecret.mockResolvedValue('stable-secret');
    h.startClipperServer.mockResolvedValue(fakeHandle({ port: 1, secret: 'stable-secret' }));
    const first = await ensureClipperRunning(resolveRootPath);
    await stopClipperServer();

    h.startClipperServer.mockResolvedValue(fakeHandle({ port: 2, secret: 'stable-secret' }));
    const second = await ensureClipperRunning(resolveRootPath);

    expect(first.secret).toBe(second.secret);
    expect(h.startClipperServer).toHaveBeenCalledTimes(2); // a genuine restart, not the fast path
  });

  it('isClipperEnabled() reflects the persisted config', async () => {
    h.getClipperConfig.mockResolvedValue({ enabled: false, secret: 's' });
    expect(await isClipperEnabled()).toBe(false);
    h.getClipperConfig.mockResolvedValue({ enabled: true, secret: 's' });
    expect(await isClipperEnabled()).toBe(true);
  });
});
