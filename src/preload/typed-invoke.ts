import { ipcRenderer } from 'electron';
import type { ChannelMap } from '../shared/ipc-contract';

/** Typed `ipcRenderer.invoke`: args checked, return typed, against the ChannelMap. */
export function invoke<K extends keyof ChannelMap>(
  channel: K, ...args: Parameters<ChannelMap[K]>
): Promise<Awaited<ReturnType<ChannelMap[K]>>> {
  return ipcRenderer.invoke(channel, ...args) as Promise<Awaited<ReturnType<ChannelMap[K]>>>;
}
