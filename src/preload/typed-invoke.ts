import { ipcRenderer } from 'electron';
import type { ChannelMap } from '../shared/ipc-contract';
import { CHANNEL_VALIDATORS } from '../shared/ipc-validators';
import { logger } from '../shared/logger';

// A main-process response that fails its ChannelMap shape (#983) is a bug. Like
// the graph write guard (#944), it is FATAL under the test runner — so a shape
// regression fails CI — but only a `console.error` in dev/prod: a boundary
// guardrail must never crash the user's app over a validator that might itself
// be too strict. The malformed value is still returned in prod so behavior is
// unchanged there; the point is to make the corruption loud, not silent.
const VALIDATION_FATAL =
  typeof process !== 'undefined' &&
  (process.env?.VITEST === 'true' || process.env?.NODE_ENV === 'test');

/**
 * Strip Svelte 5 `$state` reactive Proxy wrapping from an IPC argument.
 * Electron's structured clone rejects a Proxy outright — a call site that
 * forgets to snapshot its `$state` before calling `api.*` fails silently
 * (#281, #2094) or throws deep in DevTools with no indication which argument
 * was the culprit. `Array.isArray` and `Object.getPrototypeOf` both see
 * through a Proxy to its target, so a plain object/array gets rebuilt from
 * scratch (shedding the Proxy) while anything else — typed arrays (e.g.
 * `notebase:writeBinary`'s `Uint8Array`), `Date`, `Map`, `Set`, class
 * instances — passes through untouched: those already survive structured
 * clone natively, and a JSON round-trip would corrupt them instead.
 */
function deproxy(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(deproxy);
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(record)) {
    out[key] = deproxy(record[key]);
  }
  return out;
}

/** Typed `ipcRenderer.invoke`: args de-proxied and checked, return typed, and
 *  the resolved payload runtime-validated against the ChannelMap (#981 / #983). */
export function invoke<K extends keyof ChannelMap>(
  channel: K,
  ...args: Parameters<ChannelMap[K]>
): Promise<Awaited<ReturnType<ChannelMap[K]>>> {
  const plainArgs = args.map(deproxy) as Parameters<ChannelMap[K]>;
  const result = ipcRenderer.invoke(channel, ...plainArgs) as Promise<Awaited<ReturnType<ChannelMap[K]>>>;
  return result.then((value) => {
    const validate = CHANNEL_VALIDATORS[channel] as ((v: unknown) => boolean) | undefined;
    if (validate && !validate(value)) {
      const message = `IPC channel "${channel}" returned a payload that failed runtime validation`;
      if (VALIDATION_FATAL) throw new Error(message);
      logger('ipc').error(message, value);
    }
    return value;
  });
}
