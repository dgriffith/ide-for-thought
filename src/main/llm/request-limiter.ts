/**
 * How many model requests run at once, per provider (#2969).
 *
 * Several conversations can now be mid-turn together (and, with forks, a
 * conversation's branches), so nothing else would stop a burst of them from
 * hitting one provider key at once and getting rate limited. Each provider has
 * a lane of `limit` slots (Settings → AI, 4 by default); a request over the
 * limit waits in a first-come queue, and its turn can say so ("waiting for a
 * slot").
 *
 * A request the provider rate limits (a 429 that isn't a quota failure) gives
 * its slot back, waits — as long as `retry-after` says, or a growing backoff —
 * and tries again, up to {@link MAX_RATE_LIMIT_RETRIES} times. The SDKs retry a
 * 429 a couple of times themselves; this is the wait after they've given up,
 * long enough for a minute's rate window to clear. A 429 arrives before a reply
 * starts streaming, so a retry never repeats text the user already saw.
 *
 * Stopping a turn while it waits — for a slot or for a retry — ends the wait at
 * once, without ever taking a slot.
 */

import { classifyProviderError, toLlmFailureError } from './classify-error';
import type { ProviderId } from '../../shared/tools/providers';
import {
  DEFAULT_CONCURRENT_REQUESTS, MAX_CONCURRENT_REQUESTS, MIN_CONCURRENT_REQUESTS, type RequestWaitStatus,
} from '../../shared/tools/concurrent-requests';

export { DEFAULT_CONCURRENT_REQUESTS, type RequestWaitStatus };
export const MAX_RATE_LIMIT_RETRIES = 3;
/** The first backoff when the provider gives no `retry-after`; it doubles per retry. */
export const BASE_BACKOFF_MS = 2_000;
/** No wait is longer than this, whatever `retry-after` asks. */
export const MAX_BACKOFF_MS = 60_000;


export interface RequestRunOptions {
  signal?: AbortSignal | undefined;
  /** This provider's limit as configured now; the lane takes the latest one given. */
  limit?: number | undefined;
  onWait?: ((status: RequestWaitStatus) => void) | undefined;
}

export interface RequestLimiterDeps {
  /** Whether an error is a rate limit worth waiting out (not a quota failure). */
  isRateLimit: (err: unknown) => boolean;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/** Clamp a stored setting to the allowed range; anything unusable is the default. */
export function resolveConcurrentRequests(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_CONCURRENT_REQUESTS;
  return Math.min(MAX_CONCURRENT_REQUESTS, Math.max(MIN_CONCURRENT_REQUESTS, Math.round(raw)));
}

/**
 * How long a rate-limit error asks us to wait, in ms, or null when it doesn't
 * say. Reads `retry-after-ms`, then `retry-after` as seconds or an HTTP date,
 * from the SDKs' error `headers` (a `Headers` or a plain record).
 */
export function retryAfterMs(err: unknown, now: number = Date.now()): number | null {
  const headers = (err as { headers?: unknown } | null)?.headers;
  if (!headers || typeof headers !== 'object') return null;
  const read = (name: string): string | null => {
    const h = headers as { get?: (n: string) => string | null } & Record<string, unknown>;
    if (typeof h.get === 'function') return h.get(name);
    const v = h[name] ?? h[name.toLowerCase()];
    return typeof v === 'string' ? v : null;
  };
  const ms = Number(read('retry-after-ms'));
  if (read('retry-after-ms') !== null && Number.isFinite(ms) && ms >= 0) return ms;
  const after = read('retry-after');
  if (after === null) return null;
  const seconds = Number(after);
  if (after.trim() !== '' && Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(after);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

function abortError(): Error {
  const e = new Error('The operation was aborted');
  e.name = 'AbortError';
  return e;
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(abortError()); return; }
    const onAbort = (): void => { clearTimeout(timer); reject(abortError()); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

interface Waiter { start: () => void }
interface Lane { limit: number; active: number; queue: Waiter[] }

export interface RequestLimiter {
  run<T>(key: string, fn: () => Promise<T>, opts?: RequestRunOptions): Promise<T>;
  /** Running and queued requests for a provider, for tests and diagnostics. */
  usage(key: string): { active: number; queued: number };
}

export function createRequestLimiter(deps: RequestLimiterDeps): RequestLimiter {
  const sleep = deps.sleep ?? defaultSleep;
  const lanes = new Map<string, Lane>();
  const laneFor = (key: string, limit: number | undefined): Lane => {
    let lane = lanes.get(key);
    if (!lane) { lane = { limit: DEFAULT_CONCURRENT_REQUESTS, active: 0, queue: [] }; lanes.set(key, lane); }
    if (limit !== undefined) lane.limit = resolveConcurrentRequests(limit);
    return lane;
  };
  const pump = (lane: Lane): void => {
    while (lane.active < lane.limit && lane.queue.length > 0) {
      lane.active++;
      lane.queue.shift()!.start();
    }
  };

  /** Take a slot: at once if one is free, else in turn. Rejects, slotless, if stopped while waiting. */
  const acquire = (lane: Lane, opts: RequestRunOptions): Promise<void> => {
    if (opts.signal?.aborted) return Promise.reject(abortError());
    if (lane.active < lane.limit && lane.queue.length === 0) { lane.active++; return Promise.resolve(); }
    return new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        const i = lane.queue.indexOf(waiter);
        if (i >= 0) lane.queue.splice(i, 1);
        reject(abortError());
      };
      const waiter: Waiter = { start: () => { opts.signal?.removeEventListener('abort', onAbort); resolve(); } };
      lane.queue.push(waiter);
      opts.signal?.addEventListener('abort', onAbort, { once: true });
      opts.onWait?.({ kind: 'queued', ahead: lane.queue.length - 1 });
    });
  };
  const release = (lane: Lane): void => { lane.active--; pump(lane); };

  return {
    async run<T>(key: string, fn: () => Promise<T>, opts: RequestRunOptions = {}): Promise<T> {
      const lane = laneFor(key, opts.limit);
      for (let attempt = 0; ; attempt++) {
        const queued = lane.active >= lane.limit || lane.queue.length > 0;
        await acquire(lane, opts);
        if (queued) opts.onWait?.(null);
        let limited: unknown;
        try {
          return await fn();
        } catch (err) {
          if (attempt >= MAX_RATE_LIMIT_RETRIES || opts.signal?.aborted || !deps.isRateLimit(err)) throw err;
          limited = err;
        } finally {
          // Every exit gives the slot back — a rate-limited one before it waits, so others can run meanwhile.
          release(lane);
        }
        const wait = Math.min(MAX_BACKOFF_MS, retryAfterMs(limited) ?? BASE_BACKOFF_MS * 2 ** attempt);
        opts.onWait?.({ kind: 'rate-limited', retryInMs: wait, attempt: attempt + 1 });
        try {
          await sleep(wait, opts.signal);
        } finally {
          opts.onWait?.(null);
        }
      }
    },
    usage(key: string) {
      const lane = lanes.get(key);
      return { active: lane?.active ?? 0, queued: lane?.queue.length ?? 0 };
    },
  };
}

/**
 * Run one provider round-trip, classifying any throw into the shared failure
 * taxonomy before it leaves main (#1804).
 *
 * This is the single choke point: IPC strips an SDK error's `status`/`code`, so
 * a failure that isn't classified here can never be told apart from any other
 * downstream — which is how "the model is overloaded" and "your key is revoked"
 * both used to arrive in the renderer as an anonymous `console.error`.
 *
 * Wrap ONLY the provider call, never the surrounding tool execution.
 *
 * `signal` is the caller's abort signal, passed so a cancelled turn is reported
 * as cancelled whatever shape the SDK's error took (#1809).
 */
/** Model requests run through one limiter, a lane per provider (#2969). */
const requestLimiter = createRequestLimiter({ isRateLimit: (err) => classifyProviderError(err) === 'rate_limited' });

export async function withProviderErrors<T>(
  providerId: ProviderId,
  run: () => Promise<T>,
  signal?: AbortSignal,
  limit?: { concurrentRequests?: number | undefined; onWait?: ((status: RequestWaitStatus) => void) | undefined },
): Promise<T> {
  try {
    return await requestLimiter.run(providerId, run, { signal, limit: limit?.concurrentRequests, onWait: limit?.onWait });
  } catch (err) {
    throw toLlmFailureError(err, providerId, { aborted: signal?.aborted ?? false });
  }
}
