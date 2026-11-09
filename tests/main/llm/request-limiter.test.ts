/**
 * The per-provider request limiter (#2969): a lane of N slots per provider, a
 * first-come queue beyond it, a stopped request leaving the queue without a
 * slot, and a rate-limited request waiting out `retry-after` and retrying.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  BASE_BACKOFF_MS, DEFAULT_CONCURRENT_REQUESTS, MAX_BACKOFF_MS, MAX_RATE_LIMIT_RETRIES,
  createRequestLimiter, resolveConcurrentRequests, retryAfterMs,
  type RequestWaitStatus,
} from '../../../src/main/llm/request-limiter';

const rateLimit = (headers?: Record<string, string>) => Object.assign(new Error('429'), { status: 429, headers });
const isRateLimit = (err: unknown) => (err as { status?: number }).status === 429;
/** A sleep that resolves at once and records how long it was asked to wait. */
const recordingSleep = () => {
  const waits: number[] = [];
  return { waits, sleep: vi.fn(async (ms: number) => { waits.push(ms); }) };
};
const deferred = <T = void>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
};
const ticks = async (n = 5) => { for (let i = 0; i < n; i++) await Promise.resolve(); };

describe('the lane', () => {
  it('runs four at once by default and queues a fifth until one finishes', async () => {
    const limiter = createRequestLimiter({ isRateLimit });
    const gates = Array.from({ length: 5 }, () => deferred<string>());
    const started: number[] = [];
    const waits: RequestWaitStatus[] = [];
    const runs = gates.map((g, i) => limiter.run('anthropic', () => { started.push(i); return g.promise; }, {
      onWait: i === 4 ? (s) => waits.push(s) : undefined,
    }));
    await ticks();
    expect(DEFAULT_CONCURRENT_REQUESTS).toBe(4);
    expect(started).toEqual([0, 1, 2, 3]);
    expect(limiter.usage('anthropic')).toEqual({ active: 4, queued: 1 });
    expect(waits).toEqual([{ kind: 'queued', ahead: 0 }]);

    gates[1]!.resolve('one');
    await expect(runs[1]).resolves.toBe('one');
    await ticks();
    expect(started).toEqual([0, 1, 2, 3, 4]);
    expect(waits).toEqual([{ kind: 'queued', ahead: 0 }, null]);

    for (const g of gates) g.resolve('done');
    await Promise.all(runs);
    expect(limiter.usage('anthropic')).toEqual({ active: 0, queued: 0 });
  });

  it('each provider has its own lane', async () => {
    const limiter = createRequestLimiter({ isRateLimit });
    const gate = deferred();
    const a = limiter.run('anthropic', () => gate.promise, { limit: 1 });
    let openaiRan = false;
    const b = limiter.run('openai', async () => { openaiRan = true; }, { limit: 1 });
    await b;
    expect(openaiRan).toBe(true);
    gate.resolve();
    await a;
  });

  it('takes the latest limit it is given, clamped to 1–16', async () => {
    expect(resolveConcurrentRequests(0)).toBe(1);
    expect(resolveConcurrentRequests(99)).toBe(16);
    expect(resolveConcurrentRequests(2.4)).toBe(2);
    expect(resolveConcurrentRequests('8')).toBe(DEFAULT_CONCURRENT_REQUESTS);
    const limiter = createRequestLimiter({ isRateLimit });
    const gates = [deferred(), deferred()];
    const runs = gates.map((g) => limiter.run('google', () => g.promise, { limit: 1 }));
    await ticks();
    expect(limiter.usage('google')).toEqual({ active: 1, queued: 1 });
    for (const g of gates) g.resolve();
    await Promise.all(runs);
  });

  it('gives the slot back when a request fails', async () => {
    const limiter = createRequestLimiter({ isRateLimit });
    await expect(limiter.run('anthropic', async () => { throw new Error('boom'); }, { limit: 1 })).rejects.toThrow('boom');
    expect(limiter.usage('anthropic').active).toBe(0);
    await expect(limiter.run('anthropic', async () => 'next', { limit: 1 })).resolves.toBe('next');
  });

  it('a request stopped while queued leaves the queue without ever running or taking a slot', async () => {
    const limiter = createRequestLimiter({ isRateLimit });
    const gate = deferred();
    const first = limiter.run('anthropic', () => gate.promise, { limit: 1 });
    const controller = new AbortController();
    const fn = vi.fn(async () => 'never');
    const queued = limiter.run('anthropic', fn, { limit: 1, signal: controller.signal });
    await ticks();
    controller.abort();
    await expect(queued).rejects.toMatchObject({ name: 'AbortError' });
    expect(limiter.usage('anthropic')).toEqual({ active: 1, queued: 0 });
    gate.resolve();
    await first;
    expect(fn).not.toHaveBeenCalled();
    expect(limiter.usage('anthropic').active).toBe(0);
  });

  it('an already-stopped request never starts', async () => {
    const limiter = createRequestLimiter({ isRateLimit });
    const controller = new AbortController();
    controller.abort();
    const fn = vi.fn(async () => 'x');
    await expect(limiter.run('anthropic', fn, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('rate limits', () => {
  it('retries a 429 after its retry-after, giving the slot up while it waits', async () => {
    const { waits, sleep } = recordingSleep();
    const limiter = createRequestLimiter({ isRateLimit, sleep });
    const statuses: RequestWaitStatus[] = [];
    let calls = 0;
    const result = await limiter.run('anthropic', async () => {
      calls++;
      if (calls === 1) throw rateLimit({ 'retry-after': '7' });
      return 'ok';
    }, { limit: 1, onWait: (s) => statuses.push(s) });
    expect(result).toBe('ok');
    expect(waits).toEqual([7_000]);
    expect(statuses).toEqual([{ kind: 'rate-limited', retryInMs: 7_000, attempt: 1 }, null]);
    expect(limiter.usage('anthropic').active).toBe(0);
  });

  it('backs off exponentially when the provider gives no retry-after, then gives up', async () => {
    const { waits, sleep } = recordingSleep();
    const limiter = createRequestLimiter({ isRateLimit, sleep });
    const fn = vi.fn(async () => { throw rateLimit(); });
    await expect(limiter.run('anthropic', fn)).rejects.toThrow('429');
    expect(fn).toHaveBeenCalledTimes(MAX_RATE_LIMIT_RETRIES + 1);
    expect(waits).toEqual([BASE_BACKOFF_MS, BASE_BACKOFF_MS * 2, BASE_BACKOFF_MS * 4]);
  });

  it('never waits longer than the cap, whatever retry-after asks', async () => {
    const { waits, sleep } = recordingSleep();
    const limiter = createRequestLimiter({ isRateLimit, sleep });
    let calls = 0;
    await limiter.run('anthropic', async () => { if (calls++ === 0) throw rateLimit({ 'retry-after': '3600' }); });
    expect(waits).toEqual([MAX_BACKOFF_MS]);
  });

  it('does not retry anything that is not a rate limit (a quota failure, a 500, a stop)', async () => {
    const { sleep } = recordingSleep();
    const limiter = createRequestLimiter({ isRateLimit, sleep });
    const fn = vi.fn(async () => { throw Object.assign(new Error('quota'), { status: 402 }); });
    await expect(limiter.run('anthropic', fn)).rejects.toThrow('quota');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('a stop during the retry wait ends it, without retrying', async () => {
    const limiter = createRequestLimiter({ isRateLimit });
    const controller = new AbortController();
    const fn = vi.fn(async () => { throw rateLimit({ 'retry-after': '30' }); });
    const run = limiter.run('anthropic', fn, { signal: controller.signal });
    await ticks();
    controller.abort();
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(limiter.usage('anthropic')).toEqual({ active: 0, queued: 0 });
  });
});

describe('retryAfterMs', () => {
  const now = Date.parse('2026-11-09T12:00:00Z');
  it('reads seconds, milliseconds and an HTTP date, from a Headers or a plain record', () => {
    expect(retryAfterMs({ headers: { 'retry-after': '12' } }, now)).toBe(12_000);
    expect(retryAfterMs({ headers: { 'retry-after-ms': '1500', 'retry-after': '12' } }, now)).toBe(1_500);
    expect(retryAfterMs({ headers: new Headers({ 'Retry-After': '3' }) }, now)).toBe(3_000);
    expect(retryAfterMs({ headers: { 'retry-after': 'Mon, 09 Nov 2026 12:00:20 GMT' } }, now)).toBe(20_000);
  });
  it('is null when the error says nothing usable', () => {
    expect(retryAfterMs(new Error('x'), now)).toBeNull();
    expect(retryAfterMs({ headers: { 'retry-after': 'soon' } }, now)).toBeNull();
    expect(retryAfterMs(null, now)).toBeNull();
  });
});
