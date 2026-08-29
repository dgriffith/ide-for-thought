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

/** Typed `ipcRenderer.invoke`: args checked, return typed, and the resolved
 *  payload runtime-validated against the ChannelMap (#981 / #983). */
export function invoke<K extends keyof ChannelMap>(
  channel: K,
  ...args: Parameters<ChannelMap[K]>
): Promise<Awaited<ReturnType<ChannelMap[K]>>> {
  const result = ipcRenderer.invoke(channel, ...args) as Promise<Awaited<ReturnType<ChannelMap[K]>>>;
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
